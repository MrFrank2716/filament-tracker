const TOKEN_KEY = 'filament-tracker.token';

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
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
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
