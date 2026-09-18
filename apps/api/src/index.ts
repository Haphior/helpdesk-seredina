// Deliberately the first import in this file -- see the file's own comment
// for why source order here is load-bearing, not stylistic.
import './lib/startupCheck';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { MAX_ATTACHMENT_SIZE_BYTES } from './modules/attachments/service';
import { attachErrorTracking, initErrorTracking } from './lib/errorTracking';
import { rateLimitRedis } from './lib/rateLimitRedis';
import jwtPlugin from './plugins/jwt';
import apiKeyAuthPlugin from './plugins/apiKeyAuth';
import authRoutes from './modules/auth/routes';
import apiKeyRoutes from './modules/apikeys/routes';
import ticketRoutes from './modules/tickets/routes';
import teamRoutes from './modules/teams/routes';
import assetRoutes from './modules/assets/routes';
import discoveryRoutes from './modules/discovery/routes';
import emailChannelRoutes from './modules/emailchannels/routes';
import aiRoutes from './modules/ai/routes';
import customFieldRoutes from './modules/customfields/routes';
import assetCatalogRoutes from './modules/assetcatalog/routes';
import processRoutes from './modules/processes/routes';
import webhookRoutes from './modules/webhooks/routes';
import macroRoutes from './modules/macros/routes';
import slaRoutes from './modules/sla/routes';
import reportingRoutes from './modules/reporting/routes';
import dashboardRoutes from './modules/dashboard/routes';
import problemRoutes from './modules/problems/routes';
import serviceCatalogRoutes from './modules/servicecatalog/routes';
import serviceRoutes from './modules/services/routes';
import kbRoutes from './modules/kb/routes';
import onCallRoutes from './modules/oncall/routes';
import savedViewRoutes from './modules/savedviews/routes';
import notificationRoutes from './modules/notifications/routes';
import exportRoutes from './modules/export/routes';
import attachmentRoutes from './modules/attachments/routes';
import aiToolsRoutes from './modules/ai-tools/routes';

initErrorTracking();

export function buildApp() {
  // Explicit, not the framework default by omission -- Fastify's implicit 1 MiB
  // applied either way, but this makes it a decision instead of an accident.
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  attachErrorTracking(app);

  app.register(helmet);
  // redis, not the plugin's default in-process store -- see
  // lib/rateLimitRedis.ts and docs/adr/0038-multi-replica-hardening.md for
  // why a shared store is required the moment `api` runs as more than one
  // replica.
  app.register(rateLimit, { max: 300, timeWindow: '1 minute', redis: rateLimitRedis });

  // Auth here is a Bearer token (JWT or ApiKey), never a cookie, so there's no CSRF
  // exposure to reflecting the origin -- CORS_ORIGIN lets an operator lock this down
  // to their actual web origin(s); unset defaults to allow-all for local dev, where
  // the web app runs on a different Vite port than the API. In production
  // (NODE_ENV=production, set by infra/docker/Dockerfile.api's runtime image) that
  // default would be wide-open-by-omission, so it's required there instead --
  // docker-compose.yml already sets it via WEB_ORIGIN, so this only fires for an
  // operator running the built image directly without it.
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin && process.env.NODE_ENV === 'production') {
    throw new Error('CORS_ORIGIN must be set when NODE_ENV=production');
  }
  // Content-Disposition isn't on the cross-origin default-exposed header list --
  // without this, the web app's export download can read the response body but
  // not the filename the server set, and silently falls back to a generic name.
  app.register(cors, { origin: corsOrigin ? corsOrigin.split(',') : true, exposedHeaders: ['Content-Disposition'] });
  // files: 1 -- the web app sends one upload request per file (see
  // TicketDetail.tsx's sendReply), never a multi-file field in one request.
  app.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES, files: 1 } });

  app.register(jwtPlugin);
  app.register(apiKeyAuthPlugin);
  app.register(authRoutes);
  app.register(apiKeyRoutes);
  app.register(ticketRoutes);
  app.register(teamRoutes);
  app.register(assetRoutes);
  app.register(discoveryRoutes);
  app.register(emailChannelRoutes);
  app.register(aiRoutes);
  app.register(customFieldRoutes);
  app.register(assetCatalogRoutes);
  app.register(processRoutes);
  app.register(webhookRoutes);
  app.register(macroRoutes);
  app.register(slaRoutes);
  app.register(reportingRoutes);
  app.register(dashboardRoutes);
  app.register(problemRoutes);
  app.register(serviceCatalogRoutes);
  app.register(serviceRoutes);
  app.register(kbRoutes);
  app.register(onCallRoutes);
  app.register(savedViewRoutes);
  app.register(notificationRoutes);
  app.register(exportRoutes);
  app.register(attachmentRoutes);
  app.register(aiToolsRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  // Fastify's default handler echoes a thrown Error's .message as the response body,
  // which leaks internal detail (e.g. "user not found", stray Prisma errors) straight
  // to the client. Routes that need a specific status still call reply.code().send()
  // themselves (see modules/auth/routes.ts); this is only the catch-all for anything
  // that reaches here as an uncaught throw.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    // Only Fastify-native errors (validation, 404s, ...) carry a statusCode below
    // 500 -- a plain `throw new Error(...)` from service code has none, so it's
    // masked by default rather than trusting an arbitrary thrown message is safe to
    // show a client.
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
      reply.code(statusCode).send({ error: error.message });
      return;
    }
    reply.code(500).send({ error: 'internal server error' });
  });

  return app;
}

if (require.main === module) {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 4000);
  app
    .listen({ port, host: '0.0.0.0' })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
