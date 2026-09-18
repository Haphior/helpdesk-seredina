import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ingestGrafanaAlert } from './grafana';

const grafanaAlertSchema = z.object({
  status: z.enum(['firing', 'resolved']),
  title: z.string().optional(),
  message: z.string().optional(),
  groupKey: z.string().optional(),
  commonLabels: z.record(z.string()).optional(),
  commonAnnotations: z.record(z.string()).optional(),
  alerts: z.array(z.object({ status: z.string().optional(), labels: z.record(z.string()).optional(), annotations: z.record(z.string()).optional() })).optional(),
});

export default async function integrationsRoutes(app: FastifyInstance) {
  // Same ApiKey auth as /v1/alerts/v1/tickets (see plugins/apiKeyAuth.ts) --
  // Grafana's webhook contact point supports a custom "Authorization" HTTP
  // header, so `Bearer <key>` drops in with no extra auth mechanism needed.
  // See docs/adr/0039-monitoring-integrations.md.
  app.post('/v1/alerts/grafana', { preHandler: app.authenticateApiKey }, async (request, reply) => {
    const parsed = grafanaAlertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const ticket = await ingestGrafanaAlert(request.apiKeyTenantId!, parsed.data);
    return reply.code(201).send(ticket);
  });
}
