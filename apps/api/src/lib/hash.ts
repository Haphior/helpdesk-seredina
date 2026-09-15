import { createHash } from 'node:crypto';

/** Exact-match hash for high-entropy tokens (API keys) -- never for passwords. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
