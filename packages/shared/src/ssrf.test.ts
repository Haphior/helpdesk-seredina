import { describe, expect, it } from 'vitest';
import { isPrivateOrReservedIp } from './ssrf';

describe('isPrivateOrReservedIp', () => {
  it('flags loopback, RFC1918 private ranges, and link-local/cloud-metadata', () => {
    expect(isPrivateOrReservedIp('127.0.0.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5', 4)).toBe(true);
    expect(isPrivateOrReservedIp('172.16.5.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255', 4)).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1', 4)).toBe(true);
    // The AWS/GCP/Azure cloud metadata IP -- the single most common real-world
    // SSRF target, so this one specifically must never slip through.
    expect(isPrivateOrReservedIp('169.254.169.254', 4)).toBe(true);
  });

  it('does not flag ordinary public IPv4 addresses', () => {
    expect(isPrivateOrReservedIp('8.8.8.8', 4)).toBe(false);
    expect(isPrivateOrReservedIp('1.1.1.1', 4)).toBe(false);
    // Just outside the 172.16/12 boundary -- a range-check bug would often get
    // exactly this boundary wrong.
    expect(isPrivateOrReservedIp('172.32.0.1', 4)).toBe(false);
    expect(isPrivateOrReservedIp('172.15.255.255', 4)).toBe(false);
  });

  it('flags IPv6 loopback, unique-local, and link-local', () => {
    expect(isPrivateOrReservedIp('::1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('fd00::1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1', 6)).toBe(true);
  });

  it('does not flag an ordinary public IPv6 address', () => {
    expect(isPrivateOrReservedIp('2606:4700:4700::1111', 6)).toBe(false);
  });
});
