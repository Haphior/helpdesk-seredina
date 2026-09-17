import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import {
  getAgentWorkload,
  getChannelBreakdown,
  getPriorityBreakdown,
  getRecentActivity,
  getSlaCompliance,
  getTicketVolume,
} from '../src/modules/reporting/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('reporting', () => {
  let tenantId: string;
  let openStatusId: string;
  let closedStatusId: string;
  let contactId: string;
  let agentAId: string;
  let agentBId: string;
  let nextNumber = 1;

  async function makeTicket(overrides: Record<string, unknown> = {}) {
    return withTenantTx(prisma, tenantId, (tx) =>
      tx.ticket.create({
        data: {
          tenantId,
          number: nextNumber++,
          subject: 'Reporting fixture ticket',
          priority: 'NORMAL',
          statusId: openStatusId,
          contactId,
          channel: 'api',
          ...overrides,
        },
      }),
    );
  }

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `report-${tenantId.slice(0, 8)}`, name: 'Reporting Test' } }),
    );
    await withTenantTx(prisma, tenantId, (tx) => seedDefaultTicketStatuses(tx, tenantId));

    [openStatusId, closedStatusId] = await withTenantTx(prisma, tenantId, async (tx) => {
      const open = await tx.ticketStatus.findFirstOrThrow({ where: { key: 'open' } });
      const closed = await tx.ticketStatus.findFirstOrThrow({ where: { key: 'closed' } });
      return [open.id, closed.id];
    });

    contactId = await withTenantTx(prisma, tenantId, async (tx) => {
      const c = await tx.contact.create({ data: { tenantId, email: 'reporting@example.com', name: 'Reporting Contact' } });
      return c.id;
    });

    [agentAId, agentBId] = await withTenantTx(prisma, tenantId, async (tx) => {
      const a = await tx.user.create({ data: { tenantId, email: 'agent-a@example.com', name: 'Agent A', passwordHash: 'x' } });
      const b = await tx.user.create({ data: { tenantId, email: 'agent-b@example.com', name: 'Agent B', passwordHash: 'x' } });
      return [a.id, b.id];
    });
  });

  it('getTicketVolume buckets tickets by their creation day, including empty days', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    await makeTicket({ createdAt: today });
    await makeTicket({ createdAt: today });
    await makeTicket({ createdAt: twoDaysAgo });

    const volume = await getTicketVolume(tenantId, 5);
    expect(volume).toHaveLength(5);
    const todayKey = today.toISOString().slice(0, 10);
    const twoDaysAgoKey = twoDaysAgo.toISOString().slice(0, 10);
    expect(volume.find((v) => v.date === todayKey)?.count).toBe(2);
    expect(volume.find((v) => v.date === twoDaysAgoKey)?.count).toBe(1);
    // a day with no tickets is still present, at 0 -- not skipped
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    expect(volume.find((v) => v.date === yesterday.toISOString().slice(0, 10))?.count).toBe(0);
  });

  it('getPriorityBreakdown counts only non-closed tickets', async () => {
    await makeTicket({ priority: 'URGENT' });
    await makeTicket({ priority: 'URGENT' });
    await makeTicket({ priority: 'URGENT', statusId: closedStatusId }); // closed -- must not count

    const breakdown = await getPriorityBreakdown(tenantId);
    expect(breakdown.URGENT).toBe(2);
  });

  it('getSlaCompliance splits resolved tickets into met vs breached by comparing resolvedAt to resolutionDueAt', async () => {
    // Relative to "now", not a hardcoded past date -- getSlaCompliance bounds
    // its query to a rolling window (default last 90 days), so a fixture
    // resolved further back than that would silently fall outside it.
    const due = new Date();
    due.setHours(due.getHours() + 12);
    const beforeDue = new Date(due);
    beforeDue.setHours(beforeDue.getHours() - 2);
    const afterDue = new Date(due);
    afterDue.setHours(afterDue.getHours() + 2);

    await makeTicket({ resolutionDueAt: due, resolvedAt: beforeDue }); // before due -> met
    await makeTicket({ resolutionDueAt: due, resolvedAt: afterDue }); // after due -> breached
    await makeTicket({ resolutionDueAt: due, resolvedAt: null }); // still open, not resolved -- excluded
    await makeTicket({ resolutionDueAt: null, resolvedAt: new Date() }); // no SLA target at all -- excluded

    const compliance = await getSlaCompliance(tenantId);
    expect(compliance.met).toBe(1);
    expect(compliance.breached).toBe(1);
    expect(compliance.total).toBe(2);
    expect(compliance.percentMet).toBe(50);
  });

  it('getAgentWorkload groups open tickets by assignee and counts unassigned separately', async () => {
    await makeTicket({ assigneeId: agentAId });
    await makeTicket({ assigneeId: agentAId });
    await makeTicket({ assigneeId: agentBId });
    await makeTicket({ assigneeId: null });
    await makeTicket({ assigneeId: agentAId, statusId: closedStatusId }); // closed -- must not count

    const workload = await getAgentWorkload(tenantId);
    const a = workload.agents.find((x) => x.userId === agentAId);
    const b = workload.agents.find((x) => x.userId === agentBId);
    expect(a?.count).toBe(2);
    expect(b?.count).toBe(1);
    expect(workload.unassigned).toBeGreaterThanOrEqual(1);
    // sorted descending by count
    expect(workload.agents[0].count).toBeGreaterThanOrEqual(workload.agents[workload.agents.length - 1].count);
  });

  it('getChannelBreakdown counts tickets by channel', async () => {
    await makeTicket({ channel: 'alert' });
    await makeTicket({ channel: 'alert' });
    const breakdown = await getChannelBreakdown(tenantId);
    expect(breakdown.alert).toBeGreaterThanOrEqual(2);
  });

  it('getRecentActivity returns the most recently updated tickets first, capped at the limit', async () => {
    const older = await makeTicket({ subject: 'Older ticket' });
    await new Promise((r) => setTimeout(r, 10));
    const newer = await makeTicket({ subject: 'Newer ticket' });

    const recent = await getRecentActivity(tenantId, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe(newer.id);
    expect(recent.some((t) => t.id === older.id)).toBe(true);
  });
});
