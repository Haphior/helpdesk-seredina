import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, isPrivateOrReservedIp, ssrfSafeFetch } from './ssrf';

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

  it('flags IPv4 addresses smuggled inside IPv6 forms', () => {
    // IPv4-mapped, in both the dotted and the normalized hex form WHATWG URL produces.
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:7f00:1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:a9fe:a9fe', 6)).toBe(true); // 169.254.169.254
    expect(isPrivateOrReservedIp('0:0:0:0:0:ffff:10.0.0.1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('64:ff9b::a9fe:a9fe', 6)).toBe(true); // NAT64
    expect(isPrivateOrReservedIp('2002:7f00:1::', 6)).toBe(true); // 6to4 of 127.0.0.1
    expect(isPrivateOrReservedIp('::', 6)).toBe(true);
    expect(isPrivateOrReservedIp('0:0:0:0:0:0:0:1', 6)).toBe(true);
    // ...while a mapped PUBLIC address stays allowed.
    expect(isPrivateOrReservedIp('::ffff:8.8.8.8', 6)).toBe(false);
  });

  it('flags the less obvious reserved ranges', () => {
    expect(isPrivateOrReservedIp('100.64.0.1', 4)).toBe(true); // CGNAT
    expect(isPrivateOrReservedIp('198.18.0.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('224.0.0.1', 4)).toBe(true);
    expect(isPrivateOrReservedIp('255.255.255.255', 4)).toBe(true);
    expect(isPrivateOrReservedIp('ff02::1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('fec0::1', 6)).toBe(true);
    expect(isPrivateOrReservedIp('100.128.0.1', 4)).toBe(false); // just past 100.64/10
  });

  it('fails closed on input it cannot parse', () => {
    expect(isPrivateOrReservedIp('not-an-ip', 4)).toBe(true);
    expect(isPrivateOrReservedIp('1::2::3', 6)).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  it('rejects IP-literal hosts in private ranges, including bracketed IPv6', async () => {
    await expect(assertPublicUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow('private/reserved');
    await expect(assertPublicUrl('https://[::ffff:127.0.0.1]/')).rejects.toThrow('private/reserved');
    await expect(assertPublicUrl('http://[::1]:11434/v1')).rejects.toThrow('private/reserved');
  });

  it('rejects hostnames that resolve to a private address', async () => {
    await expect(assertPublicUrl('http://localhost:11434/v1')).rejects.toThrow('private/reserved');
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow('non-http(s)');
  });

  it('accepts a public IP literal', async () => {
    await expect(assertPublicUrl('https://8.8.8.8/')).resolves.toBeUndefined();
  });
});

describe('ssrfSafeFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never lets fetch follow a redirect, even if the caller asked it to', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 307, headers: { Location: 'http://169.254.169.254/' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await ssrfSafeFetch('https://8.8.8.8/hook', { method: 'POST', redirect: 'follow' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(response.ok).toBe(false);
  });

  it('does not call fetch at all for a private destination', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(ssrfSafeFetch('https://10.0.0.1/hook')).rejects.toThrow('private/reserved');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
