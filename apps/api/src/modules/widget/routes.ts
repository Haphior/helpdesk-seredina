import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveTenantIdBySlug } from '../tenants/service';
import { addWidgetMessage, getWidgetConversation, startWidgetConversation } from './service';
import { renderWidgetScript } from './widget-script';

const startSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  message: z.string().min(1).max(5000),
});

const messageSchema = z.object({
  widgetToken: z.string().min(1),
  body: z.string().min(1).max(5000),
});

/**
 * Fully public, unauthenticated -- an anonymous website visitor has no
 * Seredina account, the same trust boundary as the public KB portal
 * (docs/adr/0018-knowledge-base.md). Tenant resolved by slug, same
 * `resolveTenantIdBySlug` SECURITY DEFINER escape hatch every other
 * "no tenant context yet" entry point uses. Rate-limited more strictly than
 * this app's global default -- see docs/adr/0040-embeddable-widget.md for
 * why an anonymous, embeddable, spam-prone surface needs its own tighter
 * limit, distinct from the generic ApiKey-authenticated channels which
 * already have a real credential gating them.
 *
 * CORS: a tenant embeds this widget on THEIR OWN website, whose origin is
 * unknown in advance -- unlike the rest of this API, which locks CORS to the
 * operator's own configured CORS_ORIGIN (apps/api/src/index.ts). @fastify/cors
 * is registered with `fastify-plugin`, which deliberately breaks Fastify's
 * plugin encapsulation, so a second, more permissive `cors` registration
 * scoped to just this plugin would still patch the ROOT instance globally --
 * confirmed by reading node_modules/@fastify/cors/index.js. Instead, every
 * route below opts out of the global plugin via the documented
 * `config.cors === false` escape hatch (same file, addCorsHeadersHandler) and
 * this plugin sets its own permissive headers via a plain `onSend` hook,
 * which Fastify DOES encapsulate correctly (only applies to routes
 * registered within this same plugin scope). The explicit `OPTIONS` handlers
 * exist because @fastify/cors also registers a global wildcard
 * `fastify.options('*', ...)` for preflight; a more specific route on the
 * same path takes precedence over that wildcard in Fastify's router, so
 * these are needed to keep preflight requests off the global handler too
 * (which would otherwise reply 204 with no Allow-Origin header for an origin
 * outside CORS_ORIGIN, and the browser would then block the real request).
 * See docs/adr/0040-embeddable-widget.md.
 */
export default async function widgetRoutes(app: FastifyInstance) {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    // @fastify/helmet sets Cross-Origin-Resource-Policy: same-origin globally
    // (an onRequest hook, so it runs before this one and can be overridden
    // here) -- that header blocks cross-origin loading independently of CORS
    // entirely apart from Access-Control-*, confirmed live: a real browser
    // rejected the widget script itself with net::ERR_BLOCKED_BY_RESPONSE
    // .NotSameOrigin until this override was added. curl-based checks never
    // catch this, since CORP is a browser-enforced concept with no
    // equivalent in curl.
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    return payload;
  });

  const widgetRouteConfig = (rateLimit: { max: number; timeWindow: string }) => ({
    config: { cors: false as const, rateLimit },
  });

  const preflight = (path: string) => {
    app.options(path, { config: { cors: false as const } }, async (_request, reply) => {
      reply.code(204).send();
    });
  };

  // Not under /public/:tenantSlug -- one script serves every tenant; the
  // tenant slug is read client-side from the embedding <script>'s own
  // data-tenant attribute (see widget-script.ts), so this route needs no
  // tenant resolution at all. Short cache lifetime, not immutable: this is a
  // hand-rolled script served straight from source, not a hashed build
  // artifact, so a deployed fix should reach embedded pages reasonably soon.
  app.get('/widget.js', { config: { cors: false as const } }, async (_request, reply) => {
    reply.header('Content-Type', 'application/javascript; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=300');
    return renderWidgetScript();
  });

  app.post(
    '/public/:tenantSlug/widget/start',
    widgetRouteConfig({ max: 10, timeWindow: '1 minute' }),
    async (request, reply) => {
      const { tenantSlug } = request.params as { tenantSlug: string };
      const parsed = startSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const tenantId = await resolveTenantIdBySlug(tenantSlug);
      if (!tenantId) return reply.code(404).send({ error: 'not found' });

      const result = await startWidgetConversation(tenantId, parsed.data);
      return reply.code(201).send(result);
    },
  );
  preflight('/public/:tenantSlug/widget/start');

  app.post(
    '/public/:tenantSlug/widget/messages',
    widgetRouteConfig({ max: 30, timeWindow: '1 minute' }),
    async (request, reply) => {
      const { tenantSlug } = request.params as { tenantSlug: string };
      const parsed = messageSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const tenantId = await resolveTenantIdBySlug(tenantSlug);
      if (!tenantId) return reply.code(404).send({ error: 'not found' });

      try {
        const message = await addWidgetMessage(tenantId, parsed.data.widgetToken, parsed.data.body);
        return reply.code(201).send(message);
      } catch {
        // Same "don't let a caller distinguish wrong-tenant from wrong-token"
        // posture as the KB portal's own public routes -- both 404 identically.
        return reply.code(404).send({ error: 'not found' });
      }
    },
  );
  preflight('/public/:tenantSlug/widget/messages');

  app.get(
    '/public/:tenantSlug/widget/conversation',
    widgetRouteConfig({ max: 60, timeWindow: '1 minute' }),
    async (request, reply) => {
      const { tenantSlug } = request.params as { tenantSlug: string };
      const { widgetToken } = request.query as { widgetToken?: string };
      if (!widgetToken) return reply.code(400).send({ error: 'widgetToken is required' });

      const tenantId = await resolveTenantIdBySlug(tenantSlug);
      if (!tenantId) return reply.code(404).send({ error: 'not found' });

      try {
        const conversation = await getWidgetConversation(tenantId, widgetToken);
        return reply.send(conversation);
      } catch {
        return reply.code(404).send({ error: 'not found' });
      }
    },
  );
  preflight('/public/:tenantSlug/widget/conversation');
}
