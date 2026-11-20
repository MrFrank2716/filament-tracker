import { randomBytes } from 'node:crypto';
import { mkdir, rm, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import { env } from '@/env';
import { prisma } from '@/db';
import { HttpError } from '@/http';
import { alertOperator } from '@/services/mail';

/**
 * Files sent with outside job requests.
 *
 * They come from people without an account, so nothing about them is trusted:
 * - the name on disk is random, so an uploaded name never chooses where a file is written;
 * - only listed extensions are accepted, with a size and count limit;
 * - files are never served from a public folder, only handed to signed-in members as downloads.
 */
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const uploadRoot = path.resolve(serverRoot, env.UPLOAD_DIR);

const MB = 1024 * 1024;

export const uploadLimits = {
  maxFiles: env.UPLOAD_MAX_FILES,
  maxMb: env.UPLOAD_MAX_MB,
  extensions: env.UPLOAD_EXTENSIONS.split(',').map((ext) => ext.trim().toLowerCase().replace(/^\./, '')).filter(Boolean),
};

/** Workspace ids and stored names both come from us (cuid / random hex), never from the uploader. */
const workspaceDir = (workspaceId: string) => path.join(uploadRoot, workspaceId);
export const storedPath = (workspaceId: string, storedName: string) => path.join(workspaceDir(workspaceId), storedName);

/** Unguessable token for the public request link and for each requester's progress link. */
export const newToken = () => randomBytes(24).toString('base64url');

/** The uploader's file name, reduced to something safe to show and to offer as a download name. */
export function cleanFileName(raw: string): string {
  // Browsers send UTF-8 names; the multipart parser reads them as latin1.
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  const base = decoded.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().replace(/^\.+/, '');
  if (!cleaned) return 'file';
  const ext = path.extname(cleaned);
  return cleaned.length <= 120 ? cleaned : `${cleaned.slice(0, 120 - ext.length)}${ext}`;
}

const extensionOf = (name: string) => path.extname(name).slice(1).toLowerCase();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, done) => {
      const dir = workspaceDir((req as Request).workspaceId);
      mkdir(dir, { recursive: true }).then(
        () => done(null, dir),
        (error: Error) => done(error, dir),
      );
    },
    filename: (_req, _file, done) => done(null, randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: uploadLimits.maxMb * 1024 * 1024, files: uploadLimits.maxFiles, fields: 20, fieldSize: 20_000 },
  fileFilter: (_req, file, done) => {
    if (uploadLimits.extensions.includes(extensionOf(cleanFileName(file.originalname)))) done(null, true);
    else done(new HttpError(400, `"${cleanFileName(file.originalname)}" is not an accepted file type. Accepted: ${uploadLimits.extensions.join(', ')}`));
  },
});

// ---- Room on the disk ---------------------------------------------------------

/** Bytes free on the disk the uploads are kept on, or null where that cannot be told. */
export async function freeBytes(dir: string = uploadRoot): Promise<number | null> {
  // The folder is only made with the first upload: look at the nearest folder that exists.
  for (let at = dir; ; at = path.dirname(at)) {
    try {
      const disk = await statfs(at);
      return disk.bavail * disk.bsize;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || at === path.dirname(at)) return null;
    }
  }
}

const NO_ROOM = 'This workshop cannot take files at the moment. Please try again later, or get in touch with them another way.';

/**
 * Mount before `receiveFiles`: refuses the upload before a byte is written when the disk is nearly full.
 * The database lives on the same disk, and it must always be able to write.
 */
export const requireDiskRoom: RequestHandler = async (_req, _res, next) => {
  const free = await freeBytes();
  if (free !== null && free < env.UPLOAD_MIN_FREE_MB * MB) throw new HttpError(507, NO_ROOM);
  next();
};

/** What a workspace's request files take up together, from the sizes recorded when they arrived. */
export async function workspaceUploadBytes(workspaceId: string): Promise<number> {
  const total = await prisma.jobRequestFile.aggregate({ where: { request: { workspaceId } }, _sum: { size: true } });
  return total._sum.size ?? 0;
}

/** Throws when files of this size would take the workspace past its allowance. Call before recording them. */
export async function assertWorkspaceRoom(workspaceId: string, incomingBytes: number): Promise<void> {
  if (incomingBytes === 0) return;
  if ((await workspaceUploadBytes(workspaceId)) + incomingBytes > env.UPLOAD_MAX_WORKSPACE_MB * MB) throw new HttpError(507, NO_ROOM);
}

// ---- Tidying up -------------------------------------------------------------

const FINISHED = ['rejected', 'done'];

/**
 * Delete the files of requests that were rejected or finished more than `days` ago. The request itself, its
 * messages and the job made from it all stay; only the files go, which is what takes the room.
 * Returns how many files were removed.
 */
export async function removeOldRequestFiles(days: number = env.UPLOAD_KEEP_DAYS, now = new Date()): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const old = await prisma.jobRequestFile.findMany({
    where: { request: { status: { in: FINISHED }, updatedAt: { lt: cutoff } } },
    select: { id: true, storedName: true, request: { select: { workspaceId: true } } },
  });
  for (const file of old) {
    // The record goes first: a file with no record is only wasted room, a record with no file is a broken download.
    await prisma.jobRequestFile.delete({ where: { id: file.id } }).catch(() => undefined);
    await removeStored(file.request.workspaceId, [file.storedName]);
  }
  return old.length;
}

const DAY = 24 * 60 * 60 * 1000;

/** Once a day (and soon after starting): remove old request files, and say so when the disk is filling up. */
export function scheduleUploadCare(): void {
  let lastAlert = 0;
  const run = async () => {
    try {
      const removed = await removeOldRequestFiles();
      // The settings are named, not printed: a log should not repeat what the environment holds.
      console.log(
        removed > 0
          ? `Removed ${removed} file${removed === 1 ? '' : 's'} of requests that were rejected or finished longer ago than UPLOAD_KEEP_DAYS`
          : 'Looked for old request files to remove: none',
      );
      const free = await freeBytes();
      // Said every day, so whoever runs the server can see what the disk reports and how it is trending.
      console.log(free === null ? 'Could not read how much room the disk has' : `The disk has ${Math.round(free / MB)} MB free`);
      // Warn at twice the point where uploads stop, so there is time to act.
      if (free !== null && free < env.UPLOAD_MIN_FREE_MB * 2 * MB) {
        const room = `${Math.round(free / MB)} MB`;
        console.warn(`The disk is nearly full: ${room} free. Uploads are refused once it falls below UPLOAD_MIN_FREE_MB.`);
        if (Date.now() - lastAlert > DAY) {
          lastAlert = Date.now();
          alertOperator('Wrkbench is running out of disk space', [
            `The disk that holds the database and uploaded files has ${room} free.`,
            '',
            `Below ${env.UPLOAD_MIN_FREE_MB} MB, files sent with job requests are refused so that the database can keep writing.`,
            'Give the disk more room, or delete old job requests.',
          ]);
        }
      }
    } catch (cause) {
      console.error('Could not tidy up uploaded files', cause);
    }
  };
  setTimeout(() => void run(), 60_000).unref();
  setInterval(() => void run(), DAY).unref();
}

/** Parses a multipart request into req.body and req.files. `req.workspaceId` must already be set. */
export const receiveFiles: RequestHandler = upload.array('files', uploadLimits.maxFiles);

export const uploadedFiles = (req: Request): Express.Multer.File[] => (Array.isArray(req.files) ? req.files : []);

/** Keep bytes we produced or checked ourselves (a print's picture) beside the workspace's other files. Returns the stored name. */
export async function storeBytes(workspaceId: string, bytes: Uint8Array): Promise<string> {
  const name = randomBytes(16).toString('hex');
  await mkdir(workspaceDir(workspaceId), { recursive: true });
  await writeFile(storedPath(workspaceId, name), bytes);
  return name;
}

export async function removeStored(workspaceId: string, storedNames: string[]): Promise<void> {
  await Promise.all(storedNames.map((name) => rm(storedPath(workspaceId, name), { force: true })));
}

export async function removeWorkspaceUploads(workspaceId: string): Promise<void> {
  await rm(workspaceDir(workspaceId), { recursive: true, force: true });
}
