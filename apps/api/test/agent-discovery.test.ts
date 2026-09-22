import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';
import { checkIn, createEnrollmentToken, enrollDevice, revokeDevice } from '../src/modules/devices/service';
import { normalizeMac, sanitizeNeighbors } from '../src/modules/devices/neighbors';
import { createDiscoveryJob, ServerSideScanDisabledError } from '../src/modules/discovery/service';

/**
 * Agent-based discovery (docs/adr/0052-agent-based-discovery.md): server-side
 * scans restricted to self-hosted, machine-fingerprint dedup on re-enrollment,
 * and passive discovery from an agent's ARP/neighbor table.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe('neighbor sanitizing (pure)', () => {
  it('normalizes every common MAC notation to lowercase colon form', () => {
    expect(normalizeMac('A0-B1-C2-D3-E4-F5')).toBe('a0:b1:c2:d3:e4:f5');
    expect(normalizeMac('a0b1.c2d3.e4f5')).toBe('a0:b1:c2:d3:e4:f5');
  });

  it('drops broadcast, all-zero, and multicast MACs', () => {
    expect(normalizeMac('ff:ff:ff:ff:ff:ff')).toBeNull();
    expect(normalizeMac('00:00:00:00:00:00')).toBeNull();
    expect(normalizeMac('01:00:5e:00:00:fb')).toBeNull(); // IPv4 multicast (mDNS)
  });

  it('keeps the first entry per IP and per MAC', () => {
    const result = sanitizeNeighbors([
      { ip: '192.168.1.10', mac: 'a0:b1:c2:d3:e4:f5' },
      { ip: '192.168.1.10', mac: 'a0:b1:c2:d3:e4:f6' },
      { ip: '192.168.1.11', mac: 'A0-B1-C2-D3-E4-F5' },
      { ip: '192.168.1.12', mac: 'ff:ff:ff:ff:ff:ff' },
    ]);
    expect(result).toEqual([{ ip: '192.168.1.10', mac: 'a0:b1:c2:d3:e4:f5' }]);
  });
});

describe.skipIf(!hasDb)('Agent-based discovery', () => {
  let tenantId: string;
  const ORIGINAL_MODE = process.env.SEREDINA_MODE;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `agentdisc-${tenantId.slice(0, 8)}`, name: 'Agent Discovery' } }),
    );
  });

  afterEach(() => {
    if (ORIGINAL_MODE === undefined) delete process.env.SEREDINA_MODE;
    else process.env.SEREDINA_MODE = ORIGINAL_MODE;
  });

  const fingerprint = (seed: string) => sha256Hex(`test-machine-${seed}`);

  async function enroll(extra: { machineFingerprint?: string; macAddress?: string; hostname?: string } = {}) {
    const { token } = await createEnrollmentToken(tenantId);
    const result = await enrollDevice(token, { hostname: extra.hostname ?? 'pc-1', platform: 'linux', ...extra });
    return { ...result, hashedCredential: sha256Hex(result.credential) };
  }

  const assets = () => withTenantTx(prisma, tenantId, (tx) => tx.asset.findMany({ orderBy: { createdAt: 'asc' } }));

  describe('server-side network scans', () => {
    it('are refused outside self-hosted mode, before anything is queued', async () => {
      process.env.SEREDINA_MODE = 'cloud';
      await expect(createDiscoveryJob(tenantId, '10.0.0.0/24')).rejects.toBeInstanceOf(ServerSideScanDisabledError);

      delete process.env.SEREDINA_MODE; // unset means cloud, same as registerTenant()
      await expect(createDiscoveryJob(tenantId, '10.0.0.0/24')).rejects.toBeInstanceOf(ServerSideScanDisabledError);

      const jobs = await withTenantTx(prisma, tenantId, (tx) => tx.discoveryJob.count());
      expect(jobs).toBe(0);
    });
  });

  describe('re-enrollment dedup', () => {
    it('the same machine enrolling twice reuses its Device and Asset, and rotates the credential', async () => {
      const first = await enroll({ machineFingerprint: fingerprint('a'), hostname: 'old-name' });
      const second = await enroll({ machineFingerprint: fingerprint('a'), hostname: 'new-name' });

      expect(second.reenrolled).toBe(true);
      expect(second.deviceId).toBe(first.deviceId);
      expect(second.assetId).toBe(first.assetId);
      expect(await withTenantTx(prisma, tenantId, (tx) => tx.device.count())).toBe(1);
      expect((await assets())[0].hostname).toBe('new-name');

      // The previous install's credential no longer works; the new one does.
      await expect(checkIn(first.hashedCredential, {})).rejects.toThrow('unauthorized');
      await expect(checkIn(second.hashedCredential, {})).resolves.toBeDefined();
    });

    it('re-enrolling a revoked machine reactivates it', async () => {
      const first = await enroll({ machineFingerprint: fingerprint('b') });
      await revokeDevice(tenantId, first.deviceId);
      const second = await enroll({ machineFingerprint: fingerprint('b') });

      const device = await withTenantTx(prisma, tenantId, (tx) => tx.device.findUniqueOrThrow({ where: { id: second.deviceId } }));
      expect(device.revokedAt).toBeNull();
      await expect(checkIn(second.hashedCredential, {})).resolves.toBeDefined();
    });

    it('different machines, or agents that send no fingerprint, still get separate records', async () => {
      await enroll({ machineFingerprint: fingerprint('c') });
      await enroll({ machineFingerprint: fingerprint('d') });
      await enroll();
      await enroll();
      expect(await withTenantTx(prisma, tenantId, (tx) => tx.device.count())).toBe(4);
    });

    it('fingerprints are per tenant', async () => {
      await enroll({ machineFingerprint: fingerprint('shared') });

      const otherTenant = randomUUID();
      await withTenantTx(prisma, otherTenant, (tx) =>
        tx.tenant.create({ data: { id: otherTenant, slug: `agentdisc-${otherTenant.slice(0, 8)}`, name: 'Other' } }),
      );
      const { token } = await createEnrollmentToken(otherTenant);
      const result = await enrollDevice(token, { hostname: 'pc', platform: 'linux', machineFingerprint: fingerprint('shared') });
      expect(result.reenrolled).toBe(false);
    });
  });

  describe('passive neighbor discovery', () => {
    it('creates one AGENT_NEIGHBOR asset per neighbor, and a repeat check-in creates nothing new', async () => {
      const pc = await enroll();
      const neighbors = [
        { ip: '192.168.1.1', mac: 'a0:00:00:00:00:01' },
        { ip: '192.168.1.20', mac: 'a0:00:00:00:00:20' },
      ];

      expect(await checkIn(pc.hashedCredential, { neighbors })).toEqual({ created: 2, updated: 0 });
      expect(await checkIn(pc.hashedCredential, { neighbors })).toEqual({ created: 0, updated: 0 });

      const found = (await assets()).filter((a) => a.discoverySource === 'AGENT_NEIGHBOR');
      expect(found.map((a) => [a.ipAddress, a.macAddress])).toEqual([
        ['192.168.1.1', 'a0:00:00:00:00:01'],
        ['192.168.1.20', 'a0:00:00:00:00:20'],
      ]);
    });

    it('a DHCP lease change moves the IP on the same record instead of duplicating it', async () => {
      const pc = await enroll();
      await checkIn(pc.hashedCredential, { neighbors: [{ ip: '192.168.1.50', mac: 'a0:00:00:00:00:50' }] });
      // The printer got a new lease, and a new device picked up its old IP.
      const result = await checkIn(pc.hashedCredential, {
        neighbors: [
          { ip: '192.168.1.51', mac: 'a0:00:00:00:00:50' },
          { ip: '192.168.1.50', mac: 'a0:00:00:00:00:99' },
        ],
      });
      expect(result).toEqual({ created: 1, updated: 1 });

      const byMac = new Map((await assets()).map((a) => [a.macAddress, a.ipAddress]));
      expect(byMac.get('a0:00:00:00:00:50')).toBe('192.168.1.51');
      expect(byMac.get('a0:00:00:00:00:99')).toBe('192.168.1.50');
    });

    it("fills in the MAC on an agentless-scan record at the same IP instead of duplicating it", async () => {
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.asset.create({ data: { tenantId, name: 'switch', ipAddress: '10.0.0.2', discoverySource: 'AGENTLESS_SCAN' } }),
      );
      const pc = await enroll();
      expect(await checkIn(pc.hashedCredential, { neighbors: [{ ip: '10.0.0.2', mac: 'a0:00:00:00:00:02' }] })).toEqual({
        created: 0,
        updated: 1,
      });
      const [scanned] = (await assets()).filter((a) => a.name === 'switch');
      expect(scanned.macAddress).toBe('a0:00:00:00:00:02');
    });

    it("never edits an operator's MANUAL record -- the new device is created without the contested IP", async () => {
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.asset.create({ data: { tenantId, name: 'Reception printer', ipAddress: '10.0.0.9', macAddress: null } }),
      );
      const pc = await enroll();
      await checkIn(pc.hashedCredential, { neighbors: [{ ip: '10.0.0.9', mac: 'a0:00:00:00:00:09' }] });

      const all = await assets();
      const manual = all.find((a) => a.name === 'Reception printer')!;
      expect(manual.ipAddress).toBe('10.0.0.9');
      expect(manual.macAddress).toBeNull();
      const neighbor = all.find((a) => a.macAddress === 'a0:00:00:00:00:09')!;
      expect(neighbor.ipAddress).toBeNull();
    });

    it("an enrolled agent seen by another agent is recognized by MAC, and its lastSeenAt isn't faked", async () => {
      const laptop = await enroll({ macAddress: 'a0:00:00:00:00:aa', hostname: 'laptop' });
      const before = (await assets()).find((a) => a.id === laptop.assetId)!.lastSeenAt;

      const desktop = await enroll({ hostname: 'desktop' });
      const result = await checkIn(desktop.hashedCredential, { neighbors: [{ ip: '192.168.1.77', mac: 'A0-00-00-00-00-AA' }] });
      expect(result).toEqual({ created: 0, updated: 0 });

      const laptopAsset = (await assets()).find((a) => a.id === laptop.assetId)!;
      expect(laptopAsset.lastSeenAt).toEqual(before);
      expect(laptopAsset.ipAddress).toBeNull(); // agent assets never hold an IP (ADR 0047)
    });

    it('enrolling a device that passive discovery already found adopts that record', async () => {
      const scout = await enroll({ hostname: 'scout' });
      await checkIn(scout.hashedCredential, { neighbors: [{ ip: '192.168.1.30', mac: 'a0:00:00:00:00:30' }] });
      const discovered = (await assets()).find((a) => a.macAddress === 'a0:00:00:00:00:30')!;

      const newcomer = await enroll({ macAddress: 'a0:00:00:00:00:30', hostname: 'accounting-pc' });
      expect(newcomer.assetId).toBe(discovered.id);

      const adopted = (await assets()).find((a) => a.id === discovered.id)!;
      expect(adopted.discoverySource).toBe('AGENT');
      expect(adopted.hostname).toBe('accounting-pc');
      expect(adopted.ipAddress).toBeNull();
    });

    it('neighbor reports stay inside the reporting device’s tenant', async () => {
      const pc = await enroll();
      await checkIn(pc.hashedCredential, { neighbors: [{ ip: '172.16.0.5', mac: 'a0:00:00:00:00:05' }] });

      const otherTenant = randomUUID();
      const leaked = await withTenantTx(prisma, otherTenant, async (tx) => {
        await tx.tenant.create({ data: { id: otherTenant, slug: `agentdisc-${otherTenant.slice(0, 8)}`, name: 'Other' } });
        return tx.asset.count({ where: { macAddress: 'a0:00:00:00:00:05' } });
      });
      expect(leaked).toBe(0);
    });
  });
});
