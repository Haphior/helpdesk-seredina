// Exported so pages that need to *display* the API's own base URL (e.g. the
// Monitoring Integrations setup page's webhook URL for a tenant to paste
// into Grafana) don't hardcode a second copy of this fallback.
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
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

/** The session itself is no longer valid (expired, user deactivated or deleted): drop it and go log in again. */
export function endSession() {
  setToken(null);
  window.location.assign('/login');
}

// zod's .flatten() shape, returned as `{ error: ... }` by every route that does
// `reply.code(400).send({ error: parsed.error.flatten() })`. Recognized here so a
// validation failure reads as "title: String must contain at least 1 character(s)"
// instead of the raw JSON blob a user has no way to parse themselves.
interface ZodFlattenedError {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
}

function isZodFlattenedError(value: unknown): value is ZodFlattenedError {
  return (
    !!value &&
    typeof value === 'object' &&
    ('formErrors' in value || 'fieldErrors' in value) &&
    !('message' in value) // a plain Error-shaped object should never be mistaken for this
  );
}

function humanizeZodError(error: ZodFlattenedError): string {
  const parts: string[] = [];
  for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
    if (messages?.length) parts.push(`${field}: ${messages.join(', ')}`);
  }
  if (error.formErrors?.length) parts.push(...error.formErrors);
  return parts.length > 0 ? parts.join('; ') : 'Invalid request';
}

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string') return error;
    if (isZodFlattenedError(error)) return humanizeZodError(error);
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
    // The API answers a bare 'unauthorized' when the session itself is no
    // longer valid (token expired, user deactivated or deleted) -- distinct
    // from other 401s like a wrong KB access code. Drop the dead token and go
    // back to login instead of leaving every page erroring.
    if (res.status === 401 && token && extractErrorMessage(body, res.status) === 'unauthorized') {
      endSession();
    }
    throw new ApiError(res.status, extractErrorMessage(body, res.status));
  }
  return body as T;
}

export const apiGet = <T,>(path: string, options?: { headers?: Record<string, string> }) =>
  apiFetch<T>(path, options?.headers ? { headers: options.headers } : undefined);
export const apiPost = <T,>(path: string, data?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });
export const apiPatch = <T,>(path: string, data: unknown) =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const apiPut = <T,>(path: string, data: unknown) =>
  apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(data) });
export const apiDelete = <T,>(path: string) => apiFetch<T>(path, { method: 'DELETE' });

// FormData, not JSON -- letting the browser set its own multipart Content-Type
// (with the boundary) rather than apiFetch's default 'application/json' is why
// this doesn't just go through apiFetch directly.
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { method: 'POST', body: form, headers });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : undefined;
  if (!res.ok) throw new ApiError(res.status, extractErrorMessage(body, res.status));
  return body as T;
}

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
