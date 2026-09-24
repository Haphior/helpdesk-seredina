import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { resolveTenantIdBySlug } from '../tenants/service';
import {
  checkKbPortalAccess,
  createKbArticle,
  deleteKbArticle,
  getKbArticle,
  getKbPortalSettings,
  getPublishedKbArticleBySlug,
  listKbArticles,
  listPublishedKbArticles,
  updateKbArticle,
  updateKbPortalSettings,
} from './service';
import { searchKnowledgeBase } from './embeddings';
import { auditRequest } from '../audit/service';

const createArticleSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50000),
  published: z.boolean().optional(),
});

const updateArticleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(50000).optional(),
  published: z.boolean().optional(),
});

const searchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const semanticSearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const updatePortalSettingsSchema = z.object({
  portalEnabled: z.boolean().optional(),
  accessCode: z.string().min(4).max(200).nullable().optional(),
});

function sendPortalAccessError(reply: FastifyReply, reason: 'disabled' | 'code_required' | 'code_invalid') {
  if (reason === 'disabled') return reply.code(404).send({ error: 'not found' });
  return reply.code(401).send({ error: reason }); // 'code_required' | 'code_invalid' -- PublicKb.tsx/PublicKbArticlePage.tsx key off this
}

export default async function kbRoutes(app: FastifyInstance) {
  // Internal browsing -- tickets:read, same tier as custom field definitions:
  // any agent can read (and, below, write) the knowledge base; nothing here is
  // configuration-only the way custom field DEFINITIONS or process templates are.
  app.get('/kb-articles', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const { q, limit, offset } = searchQuerySchema.parse(request.query);
    const { articles, total } = await listKbArticles(request.user.tenantId, q, limit, offset);
    return reply.send({ articles, total });
  });

  // Standalone semantic-search endpoint, separate from the copilot's own
  // internal use of searchKnowledgeBase() (see modules/ai/service.ts's
  // suggestReply) -- exists so the RAG search quality can be tested/tuned
  // directly, without going through a full suggestReply call every time.
  app.get(
    '/kb-articles/search-semantic',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const { q, limit } = semanticSearchQuerySchema.parse(request.query);
      const results = await searchKnowledgeBase(request.user.tenantId, q, limit);
      return reply.send({ results });
    },
  );

  app.get(
    '/kb-articles/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const article = await getKbArticle(request.user.tenantId, id);
        return reply.send(article);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/kb-articles',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const parsed = createArticleSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const article = await createKbArticle(request.user.tenantId, { ...parsed.data, authorUserId: request.user.sub });
      return reply.code(201).send(article);
    },
  );

  app.patch(
    '/kb-articles/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateArticleSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const article = await updateKbArticle(request.user.tenantId, id, parsed.data);
        return reply.send(article);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    '/kb-articles/:id',
    { preHandler: [app.authenticate, requirePermission('tickets:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteKbArticle(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'article not found' });
      }
    },
  );

  // Tenant-wide config, same tier as /ai-settings: whether the public portal
  // below is reachable at all, and whether it's gated behind a shared access
  // code. hasAccessCode only, never the code itself -- same "never returns the
  // secret back" posture as TenantAiSettingsView.hasApiKey.
  app.get('/kb-settings', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    return reply.send(await getKbPortalSettings(request.user.tenantId));
  });

  app.patch('/kb-settings', { preHandler: [app.authenticate, requirePermission('tickets:manage_all')] }, async (request, reply) => {
    const parsed = updatePortalSettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const settings = await updateKbPortalSettings(request.user.tenantId, parsed.data);
    await auditRequest(request, 'kb_portal.settings_updated', { type: 'kb_settings' }, {
      ...(parsed.data.portalEnabled !== undefined ? { portalEnabled: parsed.data.portalEnabled } : {}),
      ...(parsed.data.accessCode !== undefined ? { accessCode: parsed.data.accessCode === null ? 'removed' : 'changed' } : {}),
    });
    return reply.send(settings);
  });

  // The self-service portal: deliberately no user-account auth -- a contact
  // browsing published help articles has no Seredina account to log into
  // (Contacts never authenticate; only Users/agents do). tenantSlug resolves
  // which tenant's portal this is, the same resolveTenantIdBySlug()
  // login/register already use to go from "no tenant context yet" to one --
  // see modules/tenants/service.ts. Both handlers 404 identically for "no such
  // tenant" and "no such article": a public endpoint should never let an
  // unauthenticated caller distinguish "wrong slug" from "wrong article slug"
  // by response shape.
  //
  // Two more gates sit in front of the article data itself, per
  // docs/adr/0051-kb-portal-access-control.md: the whole portal can be turned
  // off (portalEnabled), or gated behind a shared access code (never a login --
  // see kb-settings above) passed as X-Kb-Access-Code. A disabled portal 404s
  // the same as a missing tenant (nothing to reveal); a code gate 401s with a
  // distinguishable reason, since a tenant choosing to gate its own portal
  // isn't a secret the way tenant existence at login is.
  app.get('/public/:tenantSlug/kb-articles', async (request, reply) => {
    const { tenantSlug } = request.params as { tenantSlug: string };
    const { q } = searchQuerySchema.parse(request.query);
    const tenantId = await resolveTenantIdBySlug(tenantSlug);
    if (!tenantId) return reply.code(404).send({ error: 'not found' });
    const access = await checkKbPortalAccess(tenantId, request.headers['x-kb-access-code'] as string | undefined);
    if (!access.ok) return sendPortalAccessError(reply, access.reason);
    const articles = await listPublishedKbArticles(tenantId, q);
    return reply.send({ articles });
  });

  app.get('/public/:tenantSlug/kb-articles/:slug', async (request, reply) => {
    const { tenantSlug, slug } = request.params as { tenantSlug: string; slug: string };
    const tenantId = await resolveTenantIdBySlug(tenantSlug);
    if (!tenantId) return reply.code(404).send({ error: 'not found' });
    const access = await checkKbPortalAccess(tenantId, request.headers['x-kb-access-code'] as string | undefined);
    if (!access.ok) return sendPortalAccessError(reply, access.reason);
    try {
      const article = await getPublishedKbArticleBySlug(tenantId, slug);
      return reply.send(article);
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });
}
