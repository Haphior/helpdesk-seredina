import type { FastifyRequest } from 'fastify';
import { Prisma, prisma, withTenantTx } from '@seredina/db';

/**
 * Security audit log (docs/adr/0060-audit-log.md). Records who signed in, who
 * changed access, and who touched integrations and secrets -- not every ticket
 * edit (tickets have their own history). Entries are append-only: the
 * app_tenant role can't UPDATE or DELETE them.
 *
 * Never put a secret in `metadata` (a password, a token, an API key). Record
 * that it changed, never its value.
 */

export type AuditActorType = 'user' | 'system' | 'anonymous';

export interface AuditTarget {
  type: string;
  id?: string | null;
  label?: string | null;
}

export interface AuditEntry {
  action: string;
  actorType: AuditActorType;
  actorUserId?: string | null;
  actorLabel?: string | null;
  target?: AuditTarget | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Best-effort by design: a failed audit write is logged, never allowed to fail
 * the action it describes. It runs in its own transaction after that action
 * committed, so a rolled-back change never leaves an entry claiming it happened.
 */
export async function recordAudit(tenantId: string, entry: AuditEntry): Promise<void> {
  try {
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          action: entry.action,
          actorType: entry.actorType,
          actorUserId: entry.actorUserId ?? null,
          actorLabel: entry.actorLabel?.slice(0, 320) ?? null,
          targetType: entry.target?.type ?? null,
          targetId: entry.target?.id ?? null,
          targetLabel: entry.target?.label?.slice(0, 300) ?? null,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent?.slice(0, 500) ?? null,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
    );
  } catch (err) {
    console.error(`[audit] failed to record ${entry.action} for tenant ${tenantId}:`, err);
  }
}

/** Where a request came from -- request.ip honours TRUST_PROXY (see index.ts). */
export function requestOrigin(request: FastifyRequest): { ipAddress: string | null; userAgent: string | null } {
  const ua = request.headers['user-agent'];
  return { ipAddress: request.ip ?? null, userAgent: typeof ua === 'string' ? ua : null };
}

/** An action taken by the signed-in console user making this request. */
export async function auditRequest(
  request: FastifyRequest,
  action: string,
  target?: AuditTarget | null,
  metadata?: Record<string, unknown> | null,
): Promise<void> {
  const { tenantId, sub } = request.user;
  const actor = await withTenantTx(prisma, tenantId, (tx) =>
    tx.user.findUnique({ where: { id: sub }, select: { email: true } }),
  ).catch(() => null);
  await recordAudit(tenantId, {
    action,
    actorType: 'user',
    actorUserId: sub,
    actorLabel: actor?.email ?? null,
    target,
    metadata,
    ...requestOrigin(request),
  });
}

export interface AuditLogQuery {
  /** Exact action, or a prefix ending in '.' (e.g. 'auth.'). */
  action?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  /** Keyset cursor: the id of the last row of the previous page. */
  cursor?: string;
  limit?: number;
}

export async function listAuditLogs(tenantId: string, query: AuditLogQuery) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  return withTenantTx(prisma, tenantId, async (tx) => {
    let cursorRow: { createdAt: Date; id: string } | null = null;
    if (query.cursor) {
      cursorRow = await tx.auditLog.findUnique({ where: { id: query.cursor }, select: { createdAt: true, id: true } });
    }

    const where: Prisma.AuditLogWhereInput = {
      ...(query.action
        ? query.action.endsWith('.')
          ? { action: { startsWith: query.action } }
          : { action: query.action }
        : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
      ...(cursorRow
        ? {
            OR: [
              { createdAt: { lt: cursorRow.createdAt } },
              { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
            ],
          }
        : {}),
    };

    const rows = await tx.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;
    return { entries, nextCursor: hasMore ? entries[entries.length - 1].id : null };
  });
}
