import type { ErrorRequestHandler, Request } from 'express';
import { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import { env } from '@/env';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);

/** Route params can be string | string[] in Express 5 typings; we only ever use single segments. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : String(value);
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw zodToHttp(result.error);
  return result.data;
}

function zodToHttp(error: ZodError): HttpError {
  const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = issues[0];
  const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid input';
  return new HttpError(400, message, issues);
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let error = err;
  if (error instanceof ZodError) error = zodToHttp(error);

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') error = new HttpError(409, 'Something with that name already exists');
    else if (error.code === 'P2003') error = new HttpError(409, 'This is still in use elsewhere and cannot be removed');
    else if (error.code === 'P2025') error = notFound();
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  // Upload limits (multer). The numbers are in the message the client is given up front, so keep these short.
  if (error?.name === 'MulterError') {
    const tooBig = error.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({
      error: tooBig ? `Each file can be at most ${env.UPLOAD_MAX_MB} MB` : `You can send up to ${env.UPLOAD_MAX_FILES} files at a time`,
    });
    return;
  }

  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'That file is too large to import' });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }

  console.error(error);
  res.status(500).json({ error: 'Something went wrong on the server' });
};
