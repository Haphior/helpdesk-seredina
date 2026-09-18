import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { TestProviderAdapter } from '@seredina/ai-adapters';
import { createTicketFromApi, getTicket, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { updateAutonomyPolicy } from '../src/modules/ai-tools/policy';
import { listAiAgentRuns } from '../src/modules/ai-tools/agentRuns';
import { runAutonomousLoop } from '../src/modules/ai-tools/autonomousLoop';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Autonomous tool-use loop', () => {
  let tenantId: string;
  let ticketId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `autoloop-${tenantId.slice(0, 8)}`, name: 'Autoloop Tenant' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
    const ticket = await createTicketFromApi(tenantId, {
      subject: 'VPN keeps disconnecting',
      body: 'My VPN drops every few minutes.',
      contactEmail: 'customer@example.com',
      contactName: 'Jordan Customer',
    });
    ticketId = ticket.id;
  });

  it('calls get_ticket (read-only, always allowed) then finishes with a plain-text summary', async () => {
    const adapter = new TestProviderAdapter([
      { toolCalls: [{ id: 'call-1', name: 'get_ticket', input: { ticketId } }] },
      'Investigated the ticket. The customer reports frequent VPN disconnects; no action taken yet.',
    ]);

    const result = await runAutonomousLoop(tenantId, ticketId, adapter);

    expect(result.stoppedReason).toBe('completed');
    expect(result.summary).toContain('Investigated the ticket');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolCalls[0].name).toBe('get_ticket');
    // get_ticket's real result flowed back to the model, not a placeholder.
    expect(JSON.stringify(result.steps[0].toolCalls[0].result)).toContain('VPN keeps disconnecting');

    const calls = adapter.getCalls();
    expect(calls).toHaveLength(2);
  });

  it('a mutating tool call not on the allow-list comes back pending, and the model can see that', async () => {
    const adapter = new TestProviderAdapter([
      { toolCalls: [{ id: 'call-1', name: 'add_ticket_reply', input: { ticketId, body: 'Please restart your router.' } }] },
      'Drafted a reply but it needs human approval before it goes out.',
    ]);

    const result = await runAutonomousLoop(tenantId, ticketId, adapter);

    expect(result.stoppedReason).toBe('completed');
    const stepResult = result.steps[0].toolCalls[0].result as { pendingApproval: boolean };
    expect(stepResult.pendingApproval).toBe(true);

    // The reply must NOT actually have posted -- pending means pending.
    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.messages.some((m) => m.body === 'Please restart your router.')).toBe(false);

    const { runs } = await listAiAgentRuns(tenantId, { status: 'PENDING_APPROVAL' });
    expect(runs).toHaveLength(1);
    expect(runs[0].toolName).toBe('add_ticket_reply');
  });

  it('an allow-listed tool auto-executes for real inside the loop', async () => {
    await updateAutonomyPolicy(tenantId, { autoExecuteTools: ['escalate_to_human'] });

    const adapter = new TestProviderAdapter([
      { toolCalls: [{ id: 'call-1', name: 'escalate_to_human', input: { ticketId, reason: 'Needs a hardware replacement.' } }] },
      'Escalated to a human agent -- this needs a physical hardware swap.',
    ]);

    const result = await runAutonomousLoop(tenantId, ticketId, adapter);
    expect(result.stoppedReason).toBe('completed');

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.assignee).toBeNull();
    expect(ticket.messages.some((m) => m.body.includes('Needs a hardware replacement'))).toBe(true);

    const { runs } = await listAiAgentRuns(tenantId, { status: 'EXECUTED' });
    expect(runs.some((r) => r.toolName === 'escalate_to_human' && r.source === 'autonomous')).toBe(true);
  });

  it('reports a tool execution error back to the model as an error result, without crashing', async () => {
    const adapter = new TestProviderAdapter([
      { toolCalls: [{ id: 'call-1', name: 'get_ticket', input: { ticketId: 'not-a-uuid' } }] },
      'Could not look up that ticket.',
    ]);

    const result = await runAutonomousLoop(tenantId, ticketId, adapter);
    expect(result.stoppedReason).toBe('completed');
    const errorResult = result.steps[0].toolCalls[0].result as { error: string };
    expect(errorResult.error).toContain('invalid arguments');
  });

  it('stops after MAX_ITERATIONS if the model never stops requesting tool calls', async () => {
    const infiniteToolCalls = Array.from({ length: 10 }, () => ({
      toolCalls: [{ id: randomUUID(), name: 'get_ticket', input: { ticketId } }],
    }));
    const adapter = new TestProviderAdapter(infiniteToolCalls);

    const result = await runAutonomousLoop(tenantId, ticketId, adapter);

    expect(result.stoppedReason).toBe('max_iterations');
    expect(result.steps).toHaveLength(5);
  });

  it('logs an AiUsageLog row per completion call inside the loop, action="autonomous_loop"', async () => {
    const adapter = new TestProviderAdapter([
      { toolCalls: [{ id: 'call-1', name: 'get_ticket', input: { ticketId } }] },
      'Done.',
    ]);
    await runAutonomousLoop(tenantId, ticketId, adapter);

    const logs = await withTenantTx(prisma, tenantId, (tx) => tx.aiUsageLog.findMany({ where: { ticketId } }));
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.action === 'autonomous_loop')).toBe(true);
  });
});
