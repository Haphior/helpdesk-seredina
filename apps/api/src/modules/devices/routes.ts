import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { checkIn, createEnrollmentToken, enrollDevice, listDevices, revokeDevice } from './service';
import { getAgentSetup } from './agentSetup';
import { auditRequest, recordAudit, requestOrigin } from '../audit/service';

// Format only -- neighbors.ts's normalizeMac() does the real validation
// (multicast/broadcast/all-zero rejected there, not here).
const macSchema = z.string().regex(/^[0-9A-Fa-f]{2}([:-]?[0-9A-Fa-f]{2}){5}$/);

const enrollSchema = z.object({
  hostname: z.string().min(1).max(200),
  platform: z.enum(['linux', 'darwin', 'win32']),
  agentVersion: z.string().max(50).optional(),
  machineFingerprint: z.string().regex(/^[0-9a-f]{64}$/, 'machineFingerprint must be a lowercase sha256 hex digest').optional(),
  macAddress: macSchema.optional(),
});

const checkInSchema = z.object({
  cpuModel: z.string().max(200).optional(),
  memoryTotalMb: z.number().int().positive().optional(),
  diskSummary: z.array(z.object({ mount: z.string(), totalGb: z.number(), freeGb: z.number() })).optional(),
  osVersion: z.string().max(200).optional(),
  diskEncrypted: z.boolean().optional(),
  antivirusStatus: z.string().max(100).optional(),
  installedPackages: z.array(z.object({ name: z.string(), version: z.string().optional() })).max(2000).optional(),
  macAddress: macSchema.optional(),
  // IPv4 only: an agent's ARP table. Capped well above any real LAN segment's
  // neighbor count, so one device can't flood the CMDB.
  neighbors: z.array(z.object({ ip: z.string().ip({ version: 'v4' }), mac: macSchema })).max(512).optional(),
});

export default async function deviceRoutes(app: FastifyInstance) {
  // Same tier as creating a discovery job -- both mint a real credential over the CMDB.
  app.post(
    '/devices/enrollment-tokens',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const result = await createEnrollmentToken(request.user.tenantId);
      await auditRequest(request, 'device.enrollment_token_created', { type: 'device_enrollment_token' });
      return reply.code(201).send(result);
    },
  );

  // Feeds the Devices page's enrollment command: the address agents should
  // use and, for a non-public certificate, the CA the agent pins.
  app.get(
    '/devices/agent-setup',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (_request, reply) => reply.send(await getAgentSetup()),
  );

  app.get('/devices', { preHandler: [app.authenticate, requirePermission('assets:read')] }, async (request, reply) => {
    const devices = await listDevices(request.user.tenantId);
    return reply.send({ devices });
  });

  app.post(
    '/devices/:id/revoke',
    { preHandler: [app.authenticate, requirePermission('assets:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await revokeDevice(request.user.tenantId, id);
        await auditRequest(request, 'device.revoked', { type: 'device', id });
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'device not found' });
      }
    },
  );

  // No auth decorator -- the enrollment token itself, in the body, is the
  // credential (there's no Device yet to authenticate as). See
  // docs/adr/0047-endpoint-agents-v1.md.
  app.post('/v1/devices/enroll', async (request, reply) => {
    const parsed = z.object({ enrollmentToken: z.string().min(1) }).merge(enrollSchema).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const { enrollmentToken, ...input } = parsed.data;
      const { tenantId, ...result } = await enrollDevice(enrollmentToken, input);
      await recordAudit(tenantId, {
        action: result.reenrolled ? 'device.reenrolled' : 'device.enrolled',
        actorType: 'system',
        target: { type: 'device', id: result.deviceId, label: input.hostname },
        metadata: { platform: input.platform, agentVersion: input.agentVersion ?? null },
        ...requestOrigin(request),
      });
      return reply.code(201).send(result);
    } catch (err) {
      return reply.code(401).send({ error: (err as Error).message });
    }
  });

  app.post('/v1/devices/checkin', { preHandler: app.authenticateDevice }, async (request, reply) => {
    const parsed = checkInSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const neighbors = await checkIn(request.deviceHashedCredential!, parsed.data);
      return reply.code(200).send({ neighbors });
    } catch (err) {
      return reply.code(403).send({ error: (err as Error).message });
    }
  });
}
