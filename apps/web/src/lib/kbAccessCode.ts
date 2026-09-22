// The public KB portal can be gated behind a single shared access code (not a
// login -- see docs/adr/0051-kb-portal-access-control.md). Stored in
// sessionStorage per tenant slug, same "per-viewer convenience, never synced,
// wrapped in try/catch" posture as every other browser-storage use in this app
// (a private window or blocked site data just means re-entering it next visit).
const CODE_KEY_PREFIX = 'seredina_kb_code_';

export function getStoredKbAccessCode(tenantSlug?: string): string | undefined {
  if (!tenantSlug) return undefined;
  try {
    return sessionStorage.getItem(CODE_KEY_PREFIX + tenantSlug) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setStoredKbAccessCode(tenantSlug: string, code: string) {
  try {
    sessionStorage.setItem(CODE_KEY_PREFIX + tenantSlug, code);
  } catch {
    // ignore -- the code just won't persist across reloads this session
  }
}

export function kbAccessHeaders(tenantSlug?: string): Record<string, string> | undefined {
  const code = getStoredKbAccessCode(tenantSlug);
  return code ? { 'X-Kb-Access-Code': code } : undefined;
}
