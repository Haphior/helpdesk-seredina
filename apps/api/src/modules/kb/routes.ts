import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { resolveTenantIdBySlug } from '../tenants/service';
import {
  createKbArticle,
  deleteKbArticle,
  getKbArticle,
  getPublishedKbArticleBySlug,
  listKbArticles,
  listPublishedKbArticles,
  updateKbArticle,
} from './service';

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

export default async function kbRoutes(app: FastifyInstance) {
  // Internal browsing -- tickets:read, same tier as custom field definitions:
  // any agent can read (and, below, write) the knowledge base; nothing here is
  // configuration-only the way custom field DEFINITIONS or process templates are.
  app.get('/kb-articles', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const { q, limit, offset } = searchQuerySchema.parse(request.query);
    const { articles, total } = await listKbArticles(request.user.tenantId, q, limit, offset);
    return reply.send({ articles, total });
  });

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

  // The self-service portal: deliberately no auth at all -- a contact browsing
  // published help articles has no Seredina account to log into (Contacts never
  // authenticate; only Users/agents do). tenantSlug resolves which tenant's
  // portal this is, the same resolveTenantIdBySlug() login/register already use
  // to go from "no tenant context yet" to one -- see modules/tenants/service.ts.
  // Both handlers 404 identically for "no such tenant" and "no such article":
  // a public endpoint should never let an unauthenticated caller distinguish
  // "wrong slug" from "wrong article slug" by response shape.
  app.get('/public/:tenantSlug/kb-articles', async (request, reply) => {
    const { tenantSlug } = request.params as { tenantSlug: string };
    const { q } = searchQuerySchema.parse(request.query);
    const tenantId = await resolveTenantIdBySlug(tenantSlug);
    if (!tenantId) return reply.code(404).send({ error: 'not found' });
    const articles = await listPublishedKbArticles(tenantId, q);
    return reply.send({ articles });
  });

  app.get('/public/:tenantSlug/kb-articles/:slug', async (request, reply) => {
    const { tenantSlug, slug } = request.params as { tenantSlug: string; slug: string };
    const tenantId = await resolveTenantIdBySlug(tenantSlug);
    if (!tenantId) return reply.code(404).send({ error: 'not found' });
    try {
      const article = await getPublishedKbArticleBySlug(tenantId, slug);
      return reply.send(article);
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });
}
