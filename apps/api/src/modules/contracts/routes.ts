import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { createContract, contractSummary, deleteContract, getContract, listContracts, updateContract } from './service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

const baseSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['SUPPORT', 'WARRANTY', 'LICENSE', 'LEASE', 'SUBSCRIPTION', 'OTHER']),
  supplier: z.string().max(200).nullish(),
  reference: z.string().max(200).nullish(),
  startDate: date.nullish(),
  endDate: date.nullish(),
  renewalNoticeDays: z.number().int().min(0).max(365).optional(),
  cost: z.number().min(0).max(1e12).nullish(),
  currency: z.string().regex(/^[A-Za-z]{3}$/, 'use a 3-letter currency code').nullish(),
  billingPeriod: z.enum(['one_time', 'monthly', 'yearly']).nullish(),
  seats: z.number().int().min(0).max(1_000_000).nullish(),
  notes: z.string().max(5000).nullish(),
  assetIds: z.array(z.string().uuid()).max(1000).optional(),
});

const refineDates = <T extends { startDate?: string | null; endDate?: string | null }>(v: T) =>
  !v.startDate || !v.endDate || v.startDate <= v.endDate;

const createSchema = baseSchema.refine(refineDates, { message: 'the end date is before the start date', path: ['endDate'] });
const updateSchema = baseSchema.partial().refine(refineDates, { message: 'the end date is before the start date', path: ['endDate'] });

const listQuery = z.object({
  status: z.enum(['active', 'expiring', 'expired', 'no_end_date']).optional(),
  assetId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

// Same tiers as assets themselves: anyone who can see the CMDB sees contracts;
// assets:manage edits them.
export default async function contractRoutes(app: FastifyInstance) {
  app.get('/contracts', { preHandler: [app.authenticate, requirePermission('assets:read')] }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return reply.send({ contracts: await listContracts(request.user.tenantId, parsed.data) });
  });

  app.get('/contracts/summary', { preHandler: [app.authenticate, requirePermission('assets:read')] }, async (request, reply) => {
    return reply.send(await contractSummary(request.user.tenantId));
  });

  app.get('/contracts/:id', { preHandler: [app.authenticate, requirePermission('assets:read')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await getContract(request.user.tenantId, id));
    } catch {
      return reply.code(404).send({ error: 'contract not found' });
    }
  });

  app.post('/contracts', { preHandler: [app.authenticate, requirePermission('assets:manage')] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return reply.code(201).send(await createContract(request.user.tenantId, parsed.data));
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.patch('/contracts/:id', { preHandler: [app.authenticate, requirePermission('assets:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return reply.send(await updateContract(request.user.tenantId, id, parsed.data));
    } catch (err) {
      const message = (err as Error).message;
      return reply.code(message === 'contract not found' ? 404 : 400).send({ error: message });
    }
  });

  app.delete('/contracts/:id', { preHandler: [app.authenticate, requirePermission('assets:manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteContract(request.user.tenantId, id);
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'contract not found' });
    }
  });
}
