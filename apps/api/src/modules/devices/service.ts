import { randomBytes } from 'node:crypto';
import { prisma, withTenantTx, type Prisma } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';
import { ingestNeighbors, normalizeMac, type NeighborIngestResult, type NeighborReport } from './neighbors';

const TOKEN_PREFIX = 'ent_';
const CREDENTIAL_PREFIX = 'dev_';
const ENROLLMENT_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface CreatedEnrollmentToken {
  /** Returned once, at creation time only -- never retrievable again (only the hash is stored). */
  token: string;
  expiresAt: Date;
}

/** Same exact-match hash shape as ApiKey.hashedKey (packages/shared/src/crypto.ts's sha256Hex) -- a high-entropy random token, not a password. */
export async function createEnrollmentToken(tenantId: string): Promise<CreatedEnrollmentToken> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const hashedToken = sha256Hex(token);
  const expiresAt = new Date(Date.now() + ENROLLMENT_TOKEN_TTL_MS);

  await withTenantTx(prisma, tenantId, (tx) => tx.deviceEnrollmentToken.create({ data: { tenantId, hashedToken, expiresAt } }));
  return { token, expiresAt };
}

/** No tenant context yet -- see resolve_tenant_id_by_enrollment_token_hash in rls/policies.sql. */
async function resolveTenantIdByEnrollmentTokenHash(hashedToken: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ tenant_id: string | null }[]>`SELECT resolve_tenant_id_by_enrollment_token_hash(${hashedToken}) AS tenant_id`;
  return rows[0]?.tenant_id ?? null;
}

/** No tenant context yet -- see resolve_tenant_id_by_device_credential_hash in rls/policies.sql. */
async function resolveTenantIdByDeviceCredentialHash(hashedCredential: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ tenant_id: string | null }[]>`SELECT resolve_tenant_id_by_device_credential_hash(${hashedCredential}) AS tenant_id`;
  return rows[0]?.tenant_id ?? null;
}

export interface EnrollDeviceInput {
  hostname: string;
  platform: string;
  agentVersion?: string;
  /** sha256 hex of the OS machine id, hashed on the device -- see Device.machineFingerprint. */
  machineFingerprint?: string;
  /** The device's own primary MAC, used to adopt a record passive discovery already created for it. */
  macAddress?: string;
}

export interface EnrolledDevice {
  /** For the audit entry the route writes -- stripped before the response goes to the agent. */
  tenantId: string;
  deviceId: string;
  assetId: string;
  /** Returned once, at enrollment time only -- never retrievable again (only the hash is stored). */
  credential: string;
  /** True when this machine was already enrolled and its existing Device+Asset were reused. */
  reenrolled: boolean;
}

/**
 * Redeems a DeviceEnrollmentToken: validates it (exists, unexpired, unused),
 * then atomically finds-or-creates the Asset + Device pair and consumes the
 * token, all inside one tenant-scoped transaction.
 *
 * Which Asset the device gets (docs/adr/0055-agent-based-discovery.md):
 * 1. Same machineFingerprint already enrolled -> reuse that Device and Asset
 *    (a reinstall, not a new machine). The credential is rotated, so the old
 *    install's credential stops working, and a revoked device is reactivated:
 *    an admin minting a fresh enrollment token for it is the explicit act.
 * 2. Else, a record passive discovery or a scan already created for this MAC
 *    -> adopt it (becomes source AGENT), keeping its history and ticket links.
 * 3. Else a new Asset.
 *
 * Agent assets never keep an ipAddress -- see docs/adr/0047-endpoint-agents-v1.md
 * (Asset's @@unique([tenantId, ipAddress]) makes a real collision risk across
 * devices sharing a dynamic/NAT'd IP; NULL never collides in Postgres).
 */
export async function enrollDevice(rawToken: string, input: EnrollDeviceInput): Promise<EnrolledDevice> {
  const hashedToken = sha256Hex(rawToken);
  const tenantId = await resolveTenantIdByEnrollmentTokenHash(hashedToken);
  if (!tenantId) throw new Error('invalid or expired enrollment token');

  const macAddress = input.macAddress ? normalizeMac(input.macAddress) : null;

  return withTenantTx(prisma, tenantId, async (tx) => {
    const enrollmentToken = await tx.deviceEnrollmentToken.findUnique({ where: { hashedToken } });
    if (!enrollmentToken || enrollmentToken.usedAt || enrollmentToken.expiresAt < new Date()) {
      throw new Error('invalid or expired enrollment token');
    }
    await tx.deviceEnrollmentToken.update({ where: { hashedToken }, data: { usedAt: new Date() } });

    const credential = CREDENTIAL_PREFIX + randomBytes(32).toString('base64url');
    const hashedCredential = sha256Hex(credential);
    const deviceFields = { platform: input.platform, agentVersion: input.agentVersion };

    const existingDevice = input.machineFingerprint
      ? await tx.device.findUnique({
          where: { tenantId_machineFingerprint: { tenantId, machineFingerprint: input.machineFingerprint } },
        })
      : null;

    if (existingDevice) {
      await tx.device.update({
        where: { id: existingDevice.id },
        data: { ...deviceFields, hashedCredential, revokedAt: null },
      });
      await tx.asset.update({
        where: { id: existingDevice.assetId },
        data: { hostname: input.hostname, ...(macAddress ? await freeMacFor(tx, macAddress, existingDevice.assetId) : {}), lastSeenAt: new Date() },
      });
      return { tenantId, deviceId: existingDevice.id, assetId: existingDevice.assetId, credential, reenrolled: true };
    }

    const discovered = macAddress
      ? await tx.asset.findFirst({
          where: { macAddress, discoverySource: { in: ['AGENT_NEIGHBOR', 'AGENTLESS_SCAN'] }, device: null },
        })
      : null;

    const assetData = {
      name: input.hostname,
      assetType: 'WORKSTATION' as const,
      hostname: input.hostname,
      discoverySource: 'AGENT' as const,
      lastSeenAt: new Date(),
    };
    const asset = discovered
      ? await tx.asset.update({ where: { id: discovered.id }, data: { ...assetData, ipAddress: null } })
      : await tx.asset.create({
          data: { tenantId, ...assetData, ...(macAddress ? await freeMacFor(tx, macAddress) : {}) },
        });

    const device = await tx.device.create({
      data: { tenantId, assetId: asset.id, hashedCredential, machineFingerprint: input.machineFingerprint, ...deviceFields },
    });

    return { tenantId, deviceId: device.id, assetId: asset.id, credential, reenrolled: false };
  });
}

/**
 * `{ macAddress }` if no OTHER asset already claims that MAC, else `{}` --
 * never let two records share one, or neighbor matching becomes ambiguous.
 */
async function freeMacFor(tx: Prisma.TransactionClient, macAddress: string, ownAssetId?: string) {
  const holder = await tx.asset.findFirst({ where: { macAddress, id: ownAssetId ? { not: ownAssetId } : undefined } });
  return holder ? {} : { macAddress };
}

export interface DeviceListItem {
  id: string;
  platform: string;
  agentVersion: string | null;
  enrolledAt: Date;
  revokedAt: Date | null;
  asset: { id: string; name: string; hostname: string | null; lastSeenAt: Date | null; osVersion: string | null };
}

export async function listDevices(tenantId: string): Promise<DeviceListItem[]> {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.device.findMany({
      orderBy: { enrolledAt: 'desc' },
      select: {
        id: true,
        platform: true,
        agentVersion: true,
        enrolledAt: true,
        revokedAt: true,
        asset: { select: { id: true, name: true, hostname: true, lastSeenAt: true, osVersion: true } },
      },
    }),
  );
}

export async function revokeDevice(tenantId: string, id: string): Promise<void> {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.device.findUnique({ where: { id } });
    if (!existing) throw new Error('device not found');
    await tx.device.update({ where: { id }, data: { revokedAt: new Date() } });
  });
}

export interface CheckInInput {
  cpuModel?: string;
  memoryTotalMb?: number;
  diskSummary?: unknown;
  osVersion?: string;
  diskEncrypted?: boolean;
  antivirusStatus?: string;
  installedPackages?: unknown;
  /** The device's own primary MAC. */
  macAddress?: string;
  /** The device's ARP/neighbor table -- passive discovery, see ./neighbors.ts. */
  neighbors?: NeighborReport[];
}

/**
 * The device's own credential resolves the tenant (no context yet, same as
 * enrollment above); the Device row is then re-fetched through the normal
 * tenant-scoped path, never exposed directly by the SECURITY DEFINER function.
 * A revoked device's check-in is rejected here, not by the auth plugin --
 * revocation is a per-device state, not a credential-validity question the
 * plugin's simple hash-resolve can answer on its own.
 */
export async function checkIn(hashedCredential: string, input: CheckInInput): Promise<NeighborIngestResult> {
  const tenantId = await resolveTenantIdByDeviceCredentialHash(hashedCredential);
  if (!tenantId) throw new Error('unauthorized');

  const macAddress = input.macAddress ? normalizeMac(input.macAddress) : null;

  return withTenantTx(prisma, tenantId, async (tx) => {
    const device = await tx.device.findUnique({ where: { hashedCredential } });
    if (!device) throw new Error('unauthorized');
    if (device.revokedAt) throw new Error('device revoked');

    await tx.asset.update({
      where: { id: device.assetId },
      data: {
        cpuModel: input.cpuModel,
        memoryTotalMb: input.memoryTotalMb,
        diskSummary: input.diskSummary as Prisma.InputJsonValue | undefined,
        osVersion: input.osVersion,
        diskEncrypted: input.diskEncrypted,
        antivirusStatus: input.antivirusStatus,
        installedPackages: input.installedPackages as Prisma.InputJsonValue | undefined,
        ...(macAddress ? await freeMacFor(tx, macAddress, device.assetId) : {}),
        lastSeenAt: new Date(),
      },
    });

    return ingestNeighbors(tx, tenantId, input.neighbors ?? []);
  });
}
