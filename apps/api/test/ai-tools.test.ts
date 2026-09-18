import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createTicketFromApi, getTicket, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { createMacro } from '../src/modules/macros/service';
import { runTool } from '../src/modules/ai-tools/executor';
import { getAutonomyPolicy, updateAutonomyPolicy } from '../src/modules/ai-tools/policy';
import { approveAiAgentRun, listAiAgentRuns, rejectAiAgentRun } from '../src/modules/ai-tools/agentRuns';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('AI tool catalog + AutonomyPolicy + AiAgentRun', () => {
  let tenantId: string;
  let ticketId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `tools-${tenantId.slice(0, 8)}`, name: 'Tool Catalog Tenant' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });

    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Cannot print from the shared printer',
      body: 'Getting a paper jam error every time.',
      contactEmail: 'printer-user@example.com',
      contactName: 'Printer User',
    });
    ticketId = ticket.id;
  });

  it('a fresh tenant has the safe default policy: nothing auto-executes', async () => {
    const policy = await getAutonomyPolicy(tenantId);
    expect(policy.autoExecuteTools).toEqual([]);
    expect(policy.maxActionsPerDay).toBe(20);
  });

  it('a read-only tool (get_ticket) always executes immediately, no AiAgentRun row', async () => {
    const result = await runTool(tenantId, 'get_ticket', { ticketId }, { source: 'mcp' });
    expect(result.status).toBe('executed');

    const { runs } = await listAiAgentRuns(tenantId);
    expect(runs).toHaveLength(0);
  });

  it('a mutating tool not on the allow-list becomes PENDING_APPROVAL and does not execute', async () => {
    const result = await runTool(
      tenantId,
      'add_ticket_reply',
      { ticketId, body: 'This should not post yet' },
      { source: 'mcp', ticketId },
    );
    expect(result.status).toBe('pending_approval');

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.messages.some((m) => m.body === 'This should not post yet')).toBe(false);

    const { runs } = await listAiAgentRuns(tenantId, { status: 'PENDING_APPROVAL' });
    expect(runs).toHaveLength(1);
    expect(runs[0].toolName).toBe('add_ticket_reply');
  });

  it('approving a pending run actually executes it, authored as AI', async () => {
    const result = await runTool(tenantId, 'add_ticket_reply', { ticketId, body: 'Approved reply text' }, { source: 'mcp', ticketId });
    if (result.status !== 'pending_approval') throw new Error('expected pending_approval');

    const approver = await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.create({ data: { tenantId, email: 'reviewer@example.com', name: 'Reviewer', passwordHash: 'x' } }),
    );

    const approved = await approveAiAgentRun(tenantId, result.runId, approver.id);
    expect(approved.status).toBe('EXECUTED');
    expect(approved.reviewedByUserId).toBe(approver.id);

    const ticket = await getTicket(tenantId, ticketId);
    const posted = ticket.messages.find((m) => m.body === 'Approved reply text');
    expect(posted).toBeDefined();
    expect(posted?.authorType).toBe('AI');
  });

  it('rejecting a pending run never executes it', async () => {
    const result = await runTool(tenantId, 'add_ticket_reply', { ticketId, body: 'Should never post' }, { source: 'mcp', ticketId });
    if (result.status !== 'pending_approval') throw new Error('expected pending_approval');

    const approver = await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.create({ data: { tenantId, email: 'reviewer2@example.com', name: 'Reviewer', passwordHash: 'x' } }),
    );
    const rejected = await rejectAiAgentRun(tenantId, result.runId, approver.id);
    expect(rejected.status).toBe('REJECTED');

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.messages.some((m) => m.body === 'Should never post')).toBe(false);
  });

  it('a tool on the allow-list auto-executes immediately and logs EXECUTED', async () => {
    await updateAutonomyPolicy(tenantId, { autoExecuteTools: ['add_ticket_reply'] });

    const result = await runTool(tenantId, 'add_ticket_reply', { ticketId, body: 'Auto-executed reply' }, { source: 'mcp', ticketId });
    expect(result.status).toBe('executed');

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.messages.some((m) => m.body === 'Auto-executed reply')).toBe(true);

    const { runs } = await listAiAgentRuns(tenantId, { status: 'EXECUTED' });
    expect(runs).toHaveLength(1);
  });

  it('the daily action cap forces later auto-execute-allowed calls back to PENDING_APPROVAL', async () => {
    await updateAutonomyPolicy(tenantId, { autoExecuteTools: ['add_ticket_reply'], maxActionsPerDay: 1 });

    const first = await runTool(tenantId, 'add_ticket_reply', { ticketId, body: 'First auto reply' }, { source: 'mcp', ticketId });
    expect(first.status).toBe('executed');

    const second = await runTool(tenantId, 'add_ticket_reply', { ticketId, body: 'Second auto reply' }, { source: 'mcp', ticketId });
    expect(second.status).toBe('pending_approval');

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.messages.some((m) => m.body === 'Second auto reply')).toBe(false);
  });

  it('updateAutonomyPolicy rejects an unknown or non-mutating tool name', async () => {
    await expect(updateAutonomyPolicy(tenantId, { autoExecuteTools: ['not_a_real_tool'] })).rejects.toThrow(
      'unknown or non-mutating tool name(s)',
    );
    // get_ticket is real but read-only -- gating it would be meaningless.
    await expect(updateAutonomyPolicy(tenantId, { autoExecuteTools: ['get_ticket'] })).rejects.toThrow(
      'unknown or non-mutating tool name(s)',
    );
  });

  it('set_ticket_status resolves a human-readable key, and rejects an unknown one', async () => {
    await updateAutonomyPolicy(tenantId, { autoExecuteTools: ['set_ticket_status'] });
    const result = await runTool(tenantId, 'set_ticket_status', { ticketId, statusKey: 'resolved' }, { source: 'mcp', ticketId });
    expect(result.status).toBe('executed');

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.status.key).toBe('resolved');

    await expect(
      runTool(tenantId, 'set_ticket_status', { ticketId, statusKey: 'not-a-real-status' }, { source: 'mcp', ticketId }),
    ).rejects.toThrow('no ticket status with key');
  });

  it('escalate_to_human posts a private note and clears the assignee', async () => {
    const agent = await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.create({ data: { tenantId, email: 'agent@example.com', name: 'Agent', passwordHash: 'x' } }),
    );
    await withTenantTx(prisma, tenantId, (tx) => tx.ticket.update({ where: { id: ticketId }, data: { assigneeId: agent.id } }));

    await updateAutonomyPolicy(tenantId, { autoExecuteTools: ['escalate_to_human'] });
    const result = await runTool(
      tenantId,
      'escalate_to_human',
      { ticketId, reason: 'Customer needs a hardware replacement, outside AI scope' },
      { source: 'mcp', ticketId },
    );
    expect(result.status).toBe('executed');

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.assignee).toBeNull();
    const note = ticket.messages.find((m) => m.body.includes('Escalated to a human agent'));
    expect(note).toBeDefined();
    expect(note?.isPrivateNote).toBe(true);
  });

  it('apply_macro runs as AI-authored when invoked through the tool catalog', async () => {
    const macro = await createMacro(tenantId, {
      name: 'Close out printer ticket',
      actions: { setStatusId: undefined, addReply: { body: 'Please restart the printer.', isPrivateNote: false } },
    });

    await updateAutonomyPolicy(tenantId, { autoExecuteTools: ['apply_macro'] });
    const result = await runTool(tenantId, 'apply_macro', { ticketId, macroId: macro.id }, { source: 'mcp', ticketId });
    expect(result.status).toBe('executed');

    const ticket = await getTicket(tenantId, ticketId);
    const posted = ticket.messages.find((m) => m.body === 'Please restart the printer.');
    expect(posted?.authorType).toBe('AI');
  });

  it('throws for an unknown tool name', async () => {
    await expect(runTool(tenantId, 'delete_the_tenant', {}, { source: 'mcp' })).rejects.toThrow('unknown tool');
  });

  it('rejects approving/rejecting a run that is not pending, or does not exist', async () => {
    const reviewer = await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.create({ data: { tenantId, email: 'reviewer3@example.com', name: 'Reviewer', passwordHash: 'x' } }),
    );

    const result = await runTool(tenantId, 'add_ticket_reply', { ticketId, body: 'One approval only' }, { source: 'mcp', ticketId });
    if (result.status !== 'pending_approval') throw new Error('expected pending_approval');

    await approveAiAgentRun(tenantId, result.runId, reviewer.id);
    await expect(approveAiAgentRun(tenantId, result.runId, reviewer.id)).rejects.toThrow('not pending approval');
    await expect(rejectAiAgentRun(tenantId, result.runId, reviewer.id)).rejects.toThrow('not pending approval');
    await expect(approveAiAgentRun(tenantId, randomUUID(), reviewer.id)).rejects.toThrow('AI agent run not found');
  });

  it('throws for arguments that fail the tool schema', async () => {
    await expect(runTool(tenantId, 'get_ticket', { ticketId: 'not-a-uuid' }, { source: 'mcp' })).rejects.toThrow(
      'invalid arguments',
    );
  });
});
