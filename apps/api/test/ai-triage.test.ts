import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { TestProviderAdapter } from '@seredina/ai-adapters';
import { applyAiTriage, parseTriageReply, setAiTriageMode, triageTicket, type AiTriageResult } from '../src/modules/ai/triage';
import { createTicketFromApi, finalizeWorkerCreatedTicket, seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const teams = [
  { id: 't-net', name: 'Network' },
  { id: 't-hw', name: 'Hardware' },
];

describe('parseTriageReply', () => {
  it('reads JSON even with prose around it, and only accepts offered teams and known priorities', () => {
    expect(parseTriageReply('Sure! {"priority":"high","team":"network","reason":"VPN down for one user"} done', teams)).toEqual({
      priority: 'HIGH',
      team: teams[0],
      reason: 'VPN down for one user',
    });
    expect(parseTriageReply('{"priority":"CRITICAL","team":"Finance","reason":"x"}', teams)).toBeNull();
    expect(parseTriageReply('{"priority":"LOW","team":"Finance","reason":"x"}', teams)?.team).toBeNull();
    expect(parseTriageReply('not json at all', teams)).toBeNull();
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('AI triage', () => {
  let tenantId: string;
  let networkTeamId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `triage-${tenantId.slice(0, 8)}`, name: 'Triage' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      networkTeamId = (await tx.team.create({ data: { tenantId, name: 'Network' } })).id;
      await tx.team.create({ data: { tenantId, name: 'Hardware' } });
    });
  });

  const newTicket = (subject: string, extra: Record<string, unknown> = {}) =>
    createTicketFromApi(tenantId, { subject, body: 'The whole office lost internet', contactEmail: 'c@example.com', contactName: 'C', ...extra });

  it('does nothing while off', async () => {
    await setAiTriageMode(tenantId, 'off');
    const ticket = await newTicket('Internet down');
    const adapter = new TestProviderAdapter(['{"priority":"URGENT","team":"Network","reason":"x"}']);
    expect(await triageTicket(tenantId, ticket.id, adapter)).toBeNull();
    expect(adapter.getCalls()).toHaveLength(0);
  });

  it('in suggest mode stores the suggestion without changing the ticket, and logs the AI cost', async () => {
    await setAiTriageMode(tenantId, 'suggest');
    const ticket = await newTicket('Internet down');
    const adapter = new TestProviderAdapter(['{"priority":"URGENT","team":"Network","reason":"Whole office offline"}']);
    const result = await triageTicket(tenantId, ticket.id, adapter);
    expect(result).toMatchObject({ priority: 'URGENT', teamName: 'Network', applied: false });

    const prompt = adapter.getCalls()[0].messages[0];
    expect(prompt.role === 'user' && prompt.content).toContain('Teams: Hardware, Network');

    const row = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } }));
    expect(row.priority).toBe('NORMAL');
    expect(row.teamId).toBeNull();
    expect((row.aiTriage as unknown as AiTriageResult).reason).toBe('Whole office offline');

    const usage = await withTenantTx(prisma, tenantId, (tx) => tx.aiUsageLog.findMany({ where: { ticketId: ticket.id } }));
    expect(usage.map((u) => u.action)).toEqual(['triage']);

    // Runs once per ticket.
    expect(await triageTicket(tenantId, ticket.id, new TestProviderAdapter(['{"priority":"LOW"}']))).toBeNull();

    await applyAiTriage(tenantId, ticket.id);
    const applied = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } }));
    expect(applied.priority).toBe('URGENT');
    expect(applied.teamId).toBe(networkTeamId);
  });

  it('in auto mode fills only untouched fields and leaves an internal note', async () => {
    await setAiTriageMode(tenantId, 'auto');
    const ticket = await newTicket('Printer jam', { priority: 'LOW' });
    await triageTicket(tenantId, ticket.id, new TestProviderAdapter(['{"priority":"HIGH","team":"Hardware","reason":"Printer broken"}']));

    const row = await withTenantTx(prisma, tenantId, (tx) =>
      tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { team: true, messages: true } }),
    );
    expect(row.priority).toBe('LOW'); // chosen on the way in, kept
    expect(row.team?.name).toBe('Hardware');
    const note = row.messages.find((m) => m.authorType === 'AI');
    expect(note?.isPrivateNote).toBe(true);
    expect(note?.body).toContain('team → Hardware');
  });

  it('ignores a reply it cannot use', async () => {
    const ticket = await newTicket('Something');
    expect(await triageTicket(tenantId, ticket.id, new TestProviderAdapter(['I think it is urgent']))).toBeNull();
  });
});

describe.skipIf(!hasDb)('finalizing a ticket the worker created', () => {
  it('starts the SLA clock, once', async () => {
    const tenantId = randomUUID();
    const ticketId = await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `fin-${tenantId.slice(0, 8)}`, name: 'Fin' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      await tx.slaPolicy.create({ data: { tenantId, priority: 'NORMAL', firstResponseMinutes: 60, resolutionMinutes: 480 } });
      const status = await tx.ticketStatus.findFirstOrThrow({ where: { key: 'open' } });
      const contact = await tx.contact.create({ data: { tenantId, email: 'e@example.com', name: 'E' } });
      // What apps/worker/src/email/ingest.ts creates: no SLA fields.
      const t = await tx.ticket.create({ data: { tenantId, number: 1, subject: 'From email', statusId: status.id, contactId: contact.id, channel: 'email' } });
      return t.id;
    });

    await finalizeWorkerCreatedTicket(tenantId, ticketId);
    const first = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticketId } }));
    expect(first.firstResponseDueAt).not.toBeNull();
    expect(first.resolutionDueAt!.getTime() - first.createdAt.getTime()).toBe(480 * 60 * 1000);

    await finalizeWorkerCreatedTicket(tenantId, ticketId);
    const second = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticketId } }));
    expect(second.firstResponseDueAt).toEqual(first.firstResponseDueAt);
  });
});
