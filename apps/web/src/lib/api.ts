const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'seredina_token';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') return JSON.stringify(error);
  }
  return `Request failed (${status})`;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  // Only when there's an actual body -- Fastify's JSON body parser runs for any
  // method that can carry one (DELETE included) and rejects an empty body if the
  // Content-Type header claims JSON, which a bodyless DELETE would otherwise trigger.
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, extractErrorMessage(body, res.status));
  }
  return body as T;
}

export const apiGet = <T,>(path: string) => apiFetch<T>(path);
export const apiPost = <T,>(path: string, data?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });
export const apiPatch = <T,>(path: string, data: unknown) =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const apiPut = <T,>(path: string, data: unknown) =>
  apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(data) });
export const apiDelete = <T,>(path: string) => apiFetch<T>(path, { method: 'DELETE' });

// A plain <a href> can't carry the Authorization header, so a file download needs
// its own fetch: read the raw response as a Blob, then trigger a save via a
// throwaway object-URL anchor. Used by the data-export page.
export async function downloadFile(path: string): Promise<void> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const body = res.headers.get('content-type')?.includes('application/json') ? await res.json() : undefined;
    throw new ApiError(res.status, extractErrorMessage(body, res.status));
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch ? filenameMatch[1] : 'export.json';

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
