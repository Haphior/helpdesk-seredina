import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Exact-match hash for high-entropy tokens (ApiKey.hashedKey) -- never for
 * passwords (those are bcrypt, one-way and salted, see auth/service.ts).
 * Lives in @seredina/shared rather than apps/api so any consumer that needs
 * to hash/verify an ApiKey -- apps/api's own auth plugin, and later
 * apps/mcp-server resolving a session's tenant from its own ApiKey -- uses
 * the identical implementation, never a second one.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Email channel credentials (IMAP/SMTP passwords) have to be genuinely recoverable
// -- the worker needs the real password to authenticate to a mail server, so unlike
// user passwords (bcrypt, one-way) or API keys (SHA-256, exact-match only) this is
// symmetric encryption, not hashing. AES-256-GCM: authenticated (a tampered
// ciphertext fails to decrypt rather than silently producing garbage), standard,
// built into Node's crypto with no extra dependency.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit, the GCM-recommended nonce size

/** `keyHex` must be a 64-char hex string (32 bytes) -- see ENCRYPTION_KEY in .env.example. */
export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

export function decryptSecret(payload: string, keyHex: string): string {
  const [ivHex, authTagHex, ciphertextHex] = payload.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('malformed encrypted payload');
  }
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}
