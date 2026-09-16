import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';

// Points at whatever Sentry-protocol endpoint the operator chooses -- Sentry.io's
// free tier, or a self-hosted GlitchTip instance (protocol-compatible, AGPL-friendly
// for a project that ships self-hosted). No-op when unset, which is the default: a
// dev running this locally shouldn't need an account just to boot the app.
const dsn = process.env.SENTRY_DSN;

export function initErrorTracking() {
  if (!dsn) return;
  Sentry.init({ dsn, environment: process.env.SEREDINA_MODE ?? 'self_hosted' });
}

// Reports 5xx (and >=500/<=299-per-Sentry's-own-default) errors that reach
// buildApp()'s catch-all setErrorHandler in src/index.ts -- via an onError hook, not
// by replacing that handler, so the existing message-masking behavior (never echo a
// raw thrown message to the client) is untouched.
export function attachErrorTracking(app: FastifyInstance) {
  if (!dsn) return;
  Sentry.setupFastifyErrorHandler(app);
}
