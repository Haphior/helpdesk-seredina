/**
 * Same purpose as apps/api's identical file: imported first thing in index.ts,
 * before any job-processor module that already throws its own "X env var is
 * required" one at a time at import -- see that file's comment for the full
 * reasoning and docs/adr/0031-self-hosted-startup-checks.md. No JWT_SECRET
 * here (the worker never issues or verifies tokens); DATABASE_URL isn't
 * explicitly read anywhere in apps/worker's own code (Prisma reads it
 * directly), but it's just as required in practice, so it's checked here too
 * rather than leaving it to Prisma's own, less friendly connection error.
 */
export function checkStartupEnv(): void {
  const problems: string[] = [];

  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set');
  }
  if (!process.env.REDIS_URL) {
    problems.push('REDIS_URL is not set');
  }
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    problems.push('ENCRYPTION_KEY is not set');
  } else if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    problems.push(`ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) -- got ${encryptionKey.length} characters`);
  }

  if (problems.length > 0) {
    const list = problems.map((p) => `  - ${p}`).join('\n');
    throw new Error(
      `Seredina's worker can't start -- fix these first:\n${list}\n\n` +
        'Run ./scripts/setup.sh to generate them automatically, or see .env.example.',
    );
  }
}

checkStartupEnv();
