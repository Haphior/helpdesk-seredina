import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived, signed tokens for one step of a flow -- "this password was
 * right, now ask for the code" (MFA), "this browser started an SSO sign-in".
 * The key is derived from JWT_SECRET plus the purpose, so a token minted for
 * one purpose is useless for any other, and never passes app.authenticate
 * the way a JWT signed with the session key would.
 */
function keyFor(purpose: string): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is required');
  return createHmac('sha256', secret).update(`seredina:purpose-token:v1:${purpose}`).digest();
}

export function signPurposeToken<T extends object>(purpose: string, payload: T, ttlMs: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs })).toString('base64url');
  const sig = createHmac('sha256', keyFor(purpose)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyPurposeToken<T extends object>(purpose: string, token: string, now = Date.now()): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', keyFor(purpose)).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp?: number };
    if (typeof data.exp !== 'number' || data.exp < now) return null;
    return data;
  } catch {
    return null;
  }
}
