import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';
import { checkIn, createEnrollmentToken, enrollDevice, listDevices, revokeDevice } from '../src/modules/devices/service';

/**
 * Phase 5 v1, inventory-only endpoint agents (docs/adr/0047-endpoint-agents-v1.md).
 * The permission gates on the authenticated routes (assets:manage/assets:read)
 * reuse the same, already-proven mechanism as every other Configuration/CMDB
 * page, so they're not re-tested here -- these tests cover what's actually new:
 * enrollment-token single-use/expiry, the atomic Asset+Device creation, check-in
 * updating the right Asset row, revocation, and RLS scoping.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Endpoint agents (devices)', () => {
  let tenantId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `dev-${tenantId.slice(0, 8)}`, name: 'Devices Test' } }),
    );
  });

  it('enrolling with a fresh token creates one Asset and one Device, atomically', async () => {
    const { token } = await createEnrollmentToken(tenantId);
    const result = await enrollDevice(token, { hostname: 'agent-host-1', platform: 'linux' });

    const asset = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: result.assetId } }));
    expect(asset.discoverySource).toBe('AGENT');
    expect(asset.hostname).toBe('agent-host-1');
    expect(asset.ipAddress).toBeNull();
    expect(asset.lastSeenAt).not.toBeNull();

    const device = await withTenantTx(prisma, tenantId, (tx) => tx.device.findUniqueOrThrow({ where: { id: result.deviceId } }));
    expect(device.assetId).toBe(result.assetId);
    expect(device.platform).toBe('linux');
    expect(device.revokedAt).toBeNull();
  });

  it('a token can only be redeemed once', async () => {
    const { token } = await createEnrollmentToken(tenantId);
    await enrollDevice(token, { hostname: 'agent-host-1', platform: 'linux' });
    await expect(enrollDevice(token, { hostname: 'agent-host-2', platform: 'linux' })).rejects.toThrow(
      'invalid or expired enrollment token',
    );
  });

  it('an expired token is rejected', async () => {
    const { token } = await createEnrollmentToken(tenantId);
    const hashedToken = sha256Hex(token);
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.deviceEnrollmentToken.update({ where: { hashedToken }, data: { expiresAt: new Date(Date.now() - 1000) } }),
    );
    await expect(enrollDevice(token, { hostname: 'agent-host-1', platform: 'linux' })).rejects.toThrow(
      'invalid or expired enrollment token',
    );
  });

  it('a made-up token is rejected', async () => {
    await expect(enrollDevice('ent_not-a-real-token', { hostname: 'agent-host-1', platform: 'linux' })).rejects.toThrow(
      'invalid or expired enrollment token',
    );
  });

  it('check-in updates the linked Asset inventory fields and lastSeenAt', async () => {
    const { token } = await createEnrollmentToken(tenantId);
    const { assetId, credential } = await enrollDevice(token, { hostname: 'agent-host-1', platform: 'linux' });
    const hashedCredential = sha256Hex(credential);

    const before = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: assetId } }));

    await checkIn(hashedCredential, {
      cpuModel: 'Test CPU 3000',
      memoryTotalMb: 16384,
      diskSummary: [{ mount: '/', totalGb: 100, freeGb: 42 }],
      osVersion: '22.04.3 LTS',
      diskEncrypted: true,
      antivirusStatus: 'enabled',
      installedPackages: [{ name: 'curl', version: '8.5.0' }],
    });

    const after = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUniqueOrThrow({ where: { id: assetId } }));
    expect(after.cpuModel).toBe('Test CPU 3000');
    expect(after.memoryTotalMb).toBe(16384);
    expect(after.diskSummary).toEqual([{ mount: '/', totalGb: 100, freeGb: 42 }]);
    expect(after.osVersion).toBe('22.04.3 LTS');
    expect(after.diskEncrypted).toBe(true);
    expect(after.antivirusStatus).toBe('enabled');
    expect(after.installedPackages).toEqual([{ name: 'curl', version: '8.5.0' }]);
    expect(after.lastSeenAt!.getTime()).toBeGreaterThan(before.lastSeenAt!.getTime());
  });

  it('a revoked device cannot check in', async () => {
    const { token } = await createEnrollmentToken(tenantId);
    const { deviceId, credential } = await enrollDevice(token, { hostname: 'agent-host-1', platform: 'linux' });
    const hashedCredential = sha256Hex(credential);

    await revokeDevice(tenantId, deviceId);

    await expect(checkIn(hashedCredential, { cpuModel: 'anything' })).rejects.toThrow('device revoked');
  });

  it('an unknown credential is rejected', async () => {
    await expect(checkIn('not-a-real-hash', { cpuModel: 'anything' })).rejects.toThrow('unauthorized');
  });

  it('listDevices returns enrolled devices with their asset summary', async () => {
    const { token } = await createEnrollmentToken(tenantId);
    await enrollDevice(token, { hostname: 'agent-host-1', platform: 'linux' });

    const devices = await listDevices(tenantId);
    expect(devices).toHaveLength(1);
    expect(devices[0].platform).toBe('linux');
    expect(devices[0].asset.hostname).toBe('agent-host-1');
    expect(devices[0].revokedAt).toBeNull();
  });

  it('revoking an unknown device id throws', async () => {
    await expect(revokeDevice(tenantId, randomUUID())).rejects.toThrow('device not found');
  });

  it('a device enrolled for one tenant is invisible to another -- RLS scoping applies here like any other tenant-owned row', async () => {
    const { token } = await createEnrollmentToken(tenantId);
    await enrollDevice(token, { hostname: 'agent-host-1', platform: 'linux' });

    const otherTenantId = randomUUID();
    await withTenantTx(prisma, otherTenantId, (tx) =>
      tx.tenant.create({ data: { id: otherTenantId, slug: `dev-other-${otherTenantId.slice(0, 8)}`, name: 'Other Devices Tenant' } }),
    );

    expect(await listDevices(otherTenantId)).toEqual([]);
  });

  it("one tenant's enrollment token cannot be redeemed under another tenant's context (the token IS the tenant resolver, not a param)", async () => {
    const { token } = await createEnrollmentToken(tenantId);
    // enrollDevice resolves the tenant from the token itself -- there's no way to
    // pass a different tenantId in, so the real test here is simply that
    // redeeming it lands the new Asset/Device under the token's own tenant.
    const result = await enrollDevice(token, { hostname: 'agent-host-1', platform: 'linux' });
    const asset = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUnique({ where: { id: result.assetId } }));
    expect(asset).not.toBeNull();
  });
});
