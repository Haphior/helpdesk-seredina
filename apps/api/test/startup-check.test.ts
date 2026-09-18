import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkStartupEnv } from '../src/lib/startupCheck';

describe('startup env validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://x';
    process.env.REDIS_URL = 'redis://x';
    process.env.JWT_SECRET = 'x';
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes with every required var present and a valid-length ENCRYPTION_KEY', () => {
    expect(() => checkStartupEnv()).not.toThrow();
  });

  it('lists every missing var in one error, not just the first', () => {
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    try {
      checkStartupEnv();
      expect.unreachable('expected checkStartupEnv to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('DATABASE_URL is not set');
      expect(message).toContain('JWT_SECRET is not set');
      // REDIS_URL and ENCRYPTION_KEY were left valid -- shouldn't appear.
      expect(message).not.toContain('REDIS_URL is not set');
      expect(message).not.toContain('ENCRYPTION_KEY');
    }
  });

  it('rejects an ENCRYPTION_KEY of the wrong length with the actual length in the message', () => {
    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(() => checkStartupEnv()).toThrow('got 8 characters');
  });

  it('rejects an ENCRYPTION_KEY of the right length but non-hex characters', () => {
    process.env.ENCRYPTION_KEY = 'z'.repeat(64);
    expect(() => checkStartupEnv()).toThrow('must be exactly 64 hex characters');
  });
});
