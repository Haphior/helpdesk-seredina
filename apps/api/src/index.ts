import Fastify, { type FastifyError } from 'fastify';
import jwtPlugin from './plugins/jwt';
import authRoutes from './modules/auth/routes';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(jwtPlugin);
  app.register(authRoutes);

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
