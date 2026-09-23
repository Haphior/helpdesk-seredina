import { API_URL, ApiError, extractErrorMessage } from './api';

/**
 * The customer portal's own client (docs/adr/0063-customer-portal.md). It
 * sends the portal session, never the console's token -- an agent signed in
 * to the console in the same browser must not leak their session to, or be
 * mistaken for a contact on, the portal.
 */

const key = (tenantSlug: string) => `seredina.portal.${tenantSlug}`;

export function getPortalToken(tenantSlug: string): string | null {
  try {
    return localStorage.getItem(key(tenantSlug));
  } catch {
    return null;
  }
}

export function setPortalToken(tenantSlug: string, token: string | null) {
  try {
    if (token) localStorage.setItem(key(tenantSlug), token);
    else localStorage.removeItem(key(tenantSlug));
  } catch {
    // Storage blocked: the session just won't survive a reload.
  }
}

export async function portalFetch<T>(tenantSlug: string, path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers = new Headers();
  const token = getPortalToken(tenantSlug);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`${API_URL}/public/${tenantSlug}/portal${path}`, { method: init.method ?? 'GET', headers, body });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : undefined;
  if (!res.ok) {
    if (res.status === 401 && token) setPortalToken(tenantSlug, null);
    throw new ApiError(res.status, extractErrorMessage(data, res.status));
  }
  return data as T;
}

export async function portalDownload(tenantSlug: string, attachmentId: string, filename: string) {
  const token = getPortalToken(tenantSlug);
  const res = await fetch(`${API_URL}/public/${tenantSlug}/portal/attachments/${attachmentId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
