const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Absolute URL for a backend path (also used for full-page navigations such as OAuth and Bull Board). */
export const apiUrl = (path: string): string => `${BASE}${path}`;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/** Typed JSON request. Always sends the session cookie; a 401 sends the user to /login. */
export async function request<T>(path: string, { method = 'GET', body, signal }: RequestOptions = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    credentials: 'include',
    signal,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && path !== '/api/auth/me' && window.location.pathname !== '/login') {
    window.location.assign('/login');
    throw new ApiError('Please log in again.', 401);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new ApiError(payload?.message ?? payload?.error ?? `Request failed (${response.status})`, response.status);
  }
  return (await response.json().catch(() => undefined)) as T;
}
