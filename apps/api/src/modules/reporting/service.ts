import { prisma, withTenantTx } from '@seredina/db';

/**
 * Every function here is a read-only aggregation over Ticket -- no new data
 * model beyond what already exists. Grouped/bucketed in JS after a single
 * findMany rather than raw SQL GROUP BY: simpler, consistent with the rest of
 * this codebase's Prisma-over-raw-SQL default, and fine at the ticket volumes
 * a single-tenant helpdesk actually sees. Revisit with real SQL aggregation
 * only if a tenant's volume ever makes the in-JS grouping a real cost.
 */

export async function getTicketVolume(tenantId: string, days = 14) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const tickets = await withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
  );

  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const t of tickets) {
    const key = t.createdAt.toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets, ([date, count]) => ({ date, count }));
}

export async function getPriorityBreakdown(tenantId: string) {
  const tickets = await withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findMany({ where: { status: { category: { not: 'CLOSED' } } }, select: { priority: true } }),
  );
  const counts: Record<string, number> = { LOW: 0, NORMAL: 0, HIGH: 0, URGENT: 0 };
  for (const t of tickets) counts[t.priority] = (counts[t.priority] ?? 0) + 1;
  return counts;
}

/**
 * "Met" / "breached" only counts tickets that both had an SLA target
 * (resolutionDueAt set -- opt-in, see docs/adr/0011-sla-engine.md) and are
 * actually resolved; a still-open ticket with a due date isn't done yet, so
 * it's neither -- it'll show up in the priority/workload widgets instead.
 *
 * Bounded to a rolling window (default 90 days, by resolvedAt), matching
 * every other widget in this file -- unlike those, this one used to query
 * ALL resolved tickets ever with no date bound at all, which meant a tenant
 * with years of history was scanning and returning its entire resolved-ticket
 * archive on every single dashboard load. "SLA compliance" already implicitly
 * means "recently," not "since the beginning of time."
 */
export async function getSlaCompliance(tenantId: string, days = 90) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const tickets = await withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findMany({
      where: { resolutionDueAt: { not: null }, resolvedAt: { not: null, gte: since } },
      select: { resolvedAt: true, resolutionDueAt: true },
    }),
  );
  let met = 0;
  let breached = 0;
  for (const t of tickets) {
    if (t.resolvedAt! <= t.resolutionDueAt!) met++;
    else breached++;
  }
  const total = met + breached;
  return { met, breached, total, percentMet: total === 0 ? null : Math.round((met / total) * 100) };
}

export async function getAgentWorkload(tenantId: string) {
  const tickets = await withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findMany({
      where: { status: { category: { not: 'CLOSED' } } },
      select: { assigneeId: true, assignee: { select: { name: true } } },
    }),
  );
  const counts = new Map<string, { name: string; count: number }>();
  let unassigned = 0;
  for (const t of tickets) {
    if (!t.assigneeId) {
      unassigned++;
      continue;
    }
    const existing = counts.get(t.assigneeId);
    if (existing) existing.count++;
    else counts.set(t.assigneeId, { name: t.assignee?.name ?? 'Unknown', count: 1 });
  }
  const agents = Array.from(counts, ([userId, v]) => ({ userId, name: v.name, count: v.count }));
  agents.sort((a, b) => b.count - a.count);
  return { agents, unassigned };
}

export async function getChannelBreakdown(tenantId: string, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const tickets = await withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findMany({ where: { createdAt: { gte: since } }, select: { channel: true } }),
  );
  const counts: Record<string, number> = {};
  for (const t of tickets) counts[t.channel] = (counts[t.channel] ?? 0) + 1;
  return counts;
}

/**
 * Only responded surveys count -- a requested-but-unanswered CsatResponse row
 * (the common case; most customers never click the link) has rating: null
 * and must not drag the average down or inflate the response count. Bounded
 * to a rolling window like every other widget here, by respondedAt (when the
 * signal actually happened), not requestedAt.
 */
export async function getCsatSummary(tenantId: string, days = 90) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const responses = await withTenantTx(prisma, tenantId, (tx) =>
    tx.csatResponse.findMany({ where: { respondedAt: { not: null, gte: since } }, select: { rating: true } }),
  );

  const total = responses.length;
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of responses) {
    if (r.rating) {
      distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
      sum += r.rating;
    }
  }
  return { total, average: total === 0 ? null : Math.round((sum / total) * 10) / 10, distribution };
}

export async function getRecentActivity(tenantId: string, limit = 6) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findMany({
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { status: true, contact: true },
    }),
  );
}

/** For the "my open tickets" dashboard widget -- everything assigned to the caller, not closed. */
export async function getMyOpenTickets(tenantId: string, userId: string, limit = 6) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findMany({
      where: { assigneeId: userId, status: { category: { not: 'CLOSED' } } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { status: true, contact: true },
    }),
  );
}

/**
 * For the "unassigned tickets" dashboard widget -- surfaces the actual
 * tickets (agent_workload's own `unassigned` field is already a count, this
 * is the "which ones" a team lead would click through to triage).
 */
export async function getUnassignedOpenTickets(tenantId: string, limit = 6) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findMany({
      where: { assigneeId: null, status: { category: { not: 'CLOSED' } } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { status: true, contact: true },
    }),
  );
}
