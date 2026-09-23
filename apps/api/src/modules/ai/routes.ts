import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { getAiAdapter } from './adapter';
import { getAiUsageSummary, getTicketAiUsage, suggestReply, summarizeTicket } from './service';
import { runAutonomousLoop } from '../ai-tools/autonomousLoop';
import { AI_PROVIDERS, clearTenantAiSettings, getTenantAiSettings, updateTenantAiSettings } from './settings';
import { auditRequest } from '../audit/service';
import { AI_TRIAGE_MODES, applyAiTriage, getAiTriageMode, setAiTriageMode } from './triage';

const updateAiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS).nullable().optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().max(200).nullable().optional(),
  baseUrl: z.string().url().nullable().optional(),
});

export default async function aiRoutes(app: FastifyInstance) {
  // Phase 4 bring-your-own-key (docs/adr/0036-phase-4-self-hosted-signup-byok-custom-roles.md):
  // tickets:manage_all, same tier as AI Agent Activity/webhooks/macros config
  // -- this is tenant-wide AI configuration, not a day-to-day ticket action.
  // GET never returns the key itself, decrypted or as ciphertext -- only
  // whether one is set (hasApiKey), the same "shown once at creation, never
  // again" posture as webhook signing secrets and API keys elsewhere in this
  // codebase, just with no "once" at all: the plaintext is never sent back
  // after the PATCH that set it either.
  app.get('/ai-settings', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const settings = await getTenantAiSettings(request.user.tenantId);
    return reply.send(settings);
  });

  app.patch('/ai-settings', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const parsed = updateAiSettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const settings = await updateTenantAiSettings(request.user.tenantId, parsed.data);
      // The key itself never goes in the log -- only that it was replaced.
      await auditRequest(request, 'ai_settings.updated', { type: 'ai_settings' }, {
        ...(parsed.data.provider !== undefined ? { provider: parsed.data.provider } : {}),
        ...(parsed.data.model !== undefined ? { model: parsed.data.model } : {}),
        ...(parsed.data.baseUrl !== undefined ? { baseUrl: parsed.data.baseUrl } : {}),
        ...(parsed.data.apiKey ? { apiKeyChanged: true } : {}),
      });
      return reply.send(settings);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/ai-settings', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    await clearTenantAiSettings(request.user.tenantId);
    await auditRequest(request, 'ai_settings.cleared', { type: 'ai_settings' });
    return reply.code(204).send();
  });

  // AI triage of new tickets (docs/adr/0061-ai-triage.md) -- tenant-wide, same tier as the rest of AI settings.
  app.get('/ai-triage-settings', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    return reply.send({ mode: await getAiTriageMode(request.user.tenantId) });
  });

  app.put('/ai-triage-settings', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const parsed = z.object({ mode: z.enum(AI_TRIAGE_MODES) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await setAiTriageMode(request.user.tenantId, parsed.data.mode);
    await auditRequest(request, 'ai_settings.triage_mode_changed', { type: 'ai_settings' }, { mode: parsed.data.mode });
    return reply.send({ mode: parsed.data.mode });
  });

  app.post(
    '/tickets/:id/ai/triage/apply',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await applyAiTriage(request.user.tenantId, id);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // Gated on tickets:write, same as sending a reply -- suggesting one is a lighter
  // version of the same action, never something a read-only agent should trigger.
  app.post(
    '/tickets/:id/ai/suggest-reply',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const adapter = await getAiAdapter(request.user.tenantId);
      if (!adapter) {
        return reply.code(503).send({ error: 'AI features are not configured (set AI_PROVIDER and its matching credentials)' });
      }
      const { id } = request.params as { id: string };
      try {
        const result = await suggestReply(request.user.tenantId, id, adapter);
        return reply.send(result);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/tickets/:id/ai/summarize',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const adapter = await getAiAdapter(request.user.tenantId);
      if (!adapter) {
        return reply.code(503).send({ error: 'AI features are not configured (set AI_PROVIDER and its matching credentials)' });
      }
      const { id } = request.params as { id: string };
      try {
        const result = await summarizeTicket(request.user.tenantId, id, adapter);
        return reply.send(result);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // "Autonomous mode": Seredina's own LLM decides which catalog tools to call
  // (see docs/adr/0034-second-llm-provider-and-autonomous-loop.md), not a
  // human picking one action -- still gated tickets:write to trigger, same
  // tier as suggest-reply/summarize, since every actual mutation the loop
  // performs is separately gated by AutonomyPolicy inside runTool().
  app.post(
    '/tickets/:id/ai/autonomous-run',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const adapter = await getAiAdapter(request.user.tenantId);
      if (!adapter) {
        return reply.code(503).send({ error: 'AI features are not configured (set AI_PROVIDER and its matching credentials)' });
      }
      const { id } = request.params as { id: string };
      try {
        const result = await runAutonomousLoop(request.user.tenantId, id, adapter);
        return reply.send(result);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // AI cost transparency (docs/adr/0023-ai-cost-transparency.md) -- per-ticket
  // usage is tickets:read (visible to anyone who can see the ticket), the
  // tenant-wide summary is tickets:manage_all (financial visibility, not a
  // day-to-day ticket action).
  app.get(
    '/tickets/:id/ai-usage',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const usage = await getTicketAiUsage(request.user.tenantId, id);
      return reply.send(usage);
    },
  );

  app.get(
    '/ai-usage/summary',
    { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] },
    async (request, reply) => {
      const summary = await getAiUsageSummary(request.user.tenantId);
      return reply.send(summary);
    },
  );
}
