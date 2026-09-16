import * as Sentry from '@sentry/node';

// Same DSN convention as apps/api/src/lib/errorTracking.ts -- points at Sentry.io or
// a self-hosted GlitchTip instance, no-op when unset.
const dsn = process.env.SENTRY_DSN;

export function initErrorTracking() {
  if (!dsn) return;
  Sentry.init({ dsn, environment: process.env.SEREDINA_MODE ?? 'self_hosted' });
}

export function captureError(err: unknown) {
  if (!dsn) return;
  Sentry.captureException(err);
}
