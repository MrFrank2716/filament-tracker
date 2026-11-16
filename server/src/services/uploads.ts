import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import { env } from '@/env';
import { HttpError } from '@/http';

/**
 * Files sent with outside job requests.
 *
 * They come from people without an account, so nothing about them is trusted:
 * - the name on disk is random, so an uploaded name never chooses where a file is written;
 * - only listed extensions are accepted, with a size and count limit;
 * - files are never served from a public folder, only handed to signed-in members as downloads.
 */
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const uploadRoot = path.resolve(serverRoot, env.UPLOAD_DIR);

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
