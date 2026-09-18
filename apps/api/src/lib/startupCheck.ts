/**
 * Imported first thing in index.ts, before any route module -- several of those
 * (modules/webhooks/service.ts, modules/emailchannels/service.ts, plugins/jwt.ts)
 * already throw their own "X env var is required" the moment they're imported,
 * but each only catches its own variable, one at a time: an operator missing
 * both JWT_SECRET and ENCRYPTION_KEY fixes the first, restarts, and only then
 * discovers the second. This runs before any of those imports execute (Node
 * evaluates `require()`s in source order, so being the first import in
 * index.ts is what makes that true), so a first-time self-hosted operator
 * gets one complete list instead of a one-at-a-time discovery loop -- see
 * docs/adr/0031-self-hosted-startup-checks.md.
 */
export function checkStartupEnv(): void {
  const problems: string[] = [];

  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set');
  }
  if (!process.env.REDIS_URL) {
    problems.push('REDIS_URL is not set');
  }
  if (!process.env.JWT_SECRET) {
    problems.push('JWT_SECRET is not set');
  }
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    problems.push('ENCRYPTION_KEY is not set');
  } else if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    problems.push(`ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) -- got ${encryptionKey.length} characters`);
  }

  if (problems.length > 0) {
    const list = problems.map((p) => `  - ${p}`).join('\n');
    // A plain throw here (not a logger call) is deliberate: this runs before
    // Fastify's own logger exists, and an uncaught throw's stack trace is
    // exactly as visible in `docker compose logs api` as a console.error would
    // be, with no extra plumbing needed this early.
    throw new Error(
      `Seredina can't start -- fix these first:\n${list}\n\n` +
        'Run ./scripts/setup.sh to generate them automatically, or see .env.example.',
    );
  }
}

checkStartupEnv();
