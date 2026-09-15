import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import jwtPlugin from './plugins/jwt';
import apiKeyAuthPlugin from './plugins/apiKeyAuth';
import authRoutes from './modules/auth/routes';
import apiKeyRoutes from './modules/apikeys/routes';
import ticketRoutes from './modules/tickets/routes';
import teamRoutes from './modules/teams/routes';
import assetRoutes from './modules/assets/routes';
import discoveryRoutes from './modules/discovery/routes';
import emailChannelRoutes from './modules/emailchannels/routes';

export function buildApp() {
  const app = Fastify({ logger: true });

  // Auth here is a Bearer token (JWT or ApiKey), never a cookie, so there's no CSRF
  // exposure to reflecting the origin -- CORS_ORIGIN lets an operator lock this down
  // to their actual web origin(s) in production; unset defaults to allow-all for local
  // dev, where the web app runs on a different Vite port than the API.
  const corsOrigin = process.env.CORS_ORIGIN;
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
