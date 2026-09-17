import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { attachErrorTracking, initErrorTracking } from './lib/errorTracking';
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

initErrorTracking();

export function buildApp() {
  // Explicit, not the framework default by omission -- Fastify's implicit 1 MiB
  // applied either way, but this makes it a decision instead of an accident.
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  attachErrorTracking(app);

  app.register(helmet);
  app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

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
  app.register(cors, { origin: corsOrigin ? corsOrigin.split(',') : true });

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
