/**
 * The API's public base URL -- what a browser or an identity provider uses to
 * reach it. The console and API share one address with the API under /api
 * (docs/adr/0054-server-address-and-tls.md), so WEB_ORIGIN + /api works when
 * API_PUBLIC_URL isn't set. Null when neither is configured.
 */
export function apiPublicBase(): string | null {
  const explicit = process.env.API_PUBLIC_URL?.replace(/\/$/, '');
  if (explicit) return explicit;
  const web = process.env.WEB_ORIGIN?.replace(/\/$/, '');
  return web ? `${web}/api` : null;
}

/** The console's own origin, for redirecting a browser back to it. */
export function webOrigin(): string {
  return (process.env.WEB_ORIGIN ?? '').replace(/\/$/, '');
}
