import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret } from '@seredina/shared';

describe('base32', () => {
  it('round-trips, ignoring case, spaces and trailing padding', () => {
    const secret = generateTotpSecret();
    const bytes = base32Decode(secret);
    expect(base32Encode(bytes)).toBe(secret);
    const spaced = `${secret.toLowerCase().replace(/(.{4})/g, '$1 ')}====`;
    expect(base32Decode(spaced).equals(bytes)).toBe(true);
  });

  it('rejects padding in the middle and characters outside the alphabet', () => {
    expect(() => base32Decode('AB==CD')).toThrow('invalid base32');
    expect(() => base32Decode('AB1C')).toThrow('invalid base32');
  });

  it('stays linear on a long run of padding', () => {
    const hostile = `${'='.repeat(200_000)}A`;
    const started = Date.now();
    expect(() => base32Decode(hostile)).toThrow('invalid base32');
    expect(Date.now() - started).toBeLessThan(500);
  });
});
