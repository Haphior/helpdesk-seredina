import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPublicCsatSurvey, submitCsatResponse } from './service';

const submitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

/**
 * Fully public, unauthenticated -- a ticket's contact has no Seredina
 * account, same trust boundary as the public KB portal and the widget's own
 * conversation view. Tenant resolved by slug (same shape as those), token
 * is the actual survey credential (same shape as the widget's widgetToken).
 * Both handlers 404 identically for "no such tenant" and "no such token" --
 * a public endpoint should never let a caller distinguish the two.
 */
export default async function csatRoutes(app: FastifyInstance) {
  app.get('/public/:tenantSlug/csat/:token', async (request, reply) => {
    const { tenantSlug, token } = request.params as { tenantSlug: string; token: string };
    const survey = await getPublicCsatSurvey(tenantSlug, token);
    if (!survey) return reply.code(404).send({ error: 'not found' });
    return reply.send(survey);
  });

  app.post('/public/:tenantSlug/csat/:token', async (request, reply) => {
    const { tenantSlug, token } = request.params as { tenantSlug: string; token: string };
    const parsed = submitSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const survey = await submitCsatResponse(tenantSlug, token, parsed.data);
      return reply.send(survey);
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'not found') return reply.code(404).send({ error: 'not found' });
      return reply.code(400).send({ error: message });
    }
  });
}
