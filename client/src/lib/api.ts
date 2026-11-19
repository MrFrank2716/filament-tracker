import { createKeyRing } from '@/lib/idempotency';

const TOKEN_KEY = 'filament-tracker.token';
const keys = createKeyRing();

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode: stay signed in for this tab only */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const AUTH_EXPIRED_EVENT = 'filament-tracker:auth-expired';

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const token = tokenStore.get();
  // Uploads go as multipart: the browser sets that content type, boundary included.
  const form = body instanceof FormData;
  const json = form || body === undefined ? undefined : JSON.stringify(body);
  // Every POST carries a key, and the same one again when its earlier try got no answer, so that pressing Save
  // twice after a dropped connection makes one record (see lib/idempotency.ts). Uploads are left out.
  const key = method === 'POST' && json !== undefined ? keys.keyFor(path, json) : null;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: form ? body : json,
      // A delete held back for its Undo toast may be sent as the page closes; this lets it finish.
      keepalive: method === 'DELETE',
    });
  } catch {
    if (key && json !== undefined) keys.unanswered(path, json, key);
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  // A server that fell over may or may not have done the work: keep the key for the retry, as with no answer at all.
  if (key && json !== undefined) {
    if (response.status >= 500) keys.unanswered(path, json, key);
    else keys.answered(path, json);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.error === 'string') message = data.error;
    } catch {
      /* non-JSON error body */
    }
    if (response.status === 401 && token) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    throw new ApiError(response.status, message);
  }
  return response;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: (path: string) => request<void>('DELETE', path),
  /** A stock change. `undoId` names the activity entry it became when the signed-in member may undo it. */
  postUndoable: async <T>(path: string, body: unknown): Promise<{ data: T; undoId: string | null }> => {
    const response = await send('POST', path, body);
    return { data: (await response.json()) as T, undoId: response.headers.get('X-Undo-Activity') };
  },
  /** Send fields and files together. */
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
  /** Fetch a file with the auth header and hand it to the browser as a download. */
  download: async (path: string, filename: string) => {
    const response = await send('GET', path);
    saveBlob(await response.blob(), filename);
  },
  /** Fetch a file with the auth header, for showing on the page (a picture cannot send the header itself). */
  blob: async (path: string) => (await send('GET', path)).blob(),
};

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
