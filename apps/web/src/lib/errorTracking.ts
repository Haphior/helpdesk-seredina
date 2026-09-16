import * as Sentry from '@sentry/react';

// Same DSN convention as the API/worker -- Sentry.io or a self-hosted GlitchTip
// instance, no-op when unset (the default for local dev).
const dsn = import.meta.env.VITE_SENTRY_DSN;

export function initErrorTracking() {
  if (!dsn) return;
  Sentry.init({ dsn });
}
