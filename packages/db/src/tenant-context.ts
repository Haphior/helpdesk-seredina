import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma, PrismaClient } from '@prisma/client';

interface TenantStore {
  tenantId: string;
}

const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function getTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId;
}

export function requireTenantId(): string {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error('No tenant context: this code must run inside withTenantTx()');
  }
  return tenantId;
}

/**
 * The one place tenant scoping gets bound, on every tenant-scoped request/job.
 *
 * Binds tenantId into AsyncLocalStorage (read by the Prisma Client Extension in
 * prisma.ts, the second defense layer) AND opens a Prisma *interactive* transaction
 * whose first statement sets the Postgres session variable the RLS policies key off
 * of, via a parameterized set_config call (never string-interpolated SQL).
 *
 * Interactive transactions hold one physical connection exclusively for their
 * duration, so app.tenant_id can never leak to another request via connection-pool
 * reuse -- the two classic Prisma+RLS mistakes (bare `SET LOCAL` outside a
 * transaction evaporating before the next query, or non-local `SET` leaking across a
 * pooled connection) are both structurally avoided.
 *
 * IMPORTANT: never call slow external I/O (LLM completions, SMTP sends, ...) inside
 * `fn`. It would hold this pooled connection open for the duration and starve the
 * pool under load. Read inside a short withTenantTx, call out to the network with no
 * transaction open, then write inside a second short withTenantTx.
 */
export async function withTenantTx<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return tenantStorage.run({ tenantId }, () =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }),
  );
}
