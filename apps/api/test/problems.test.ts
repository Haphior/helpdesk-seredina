import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createTicketFromApi, seedDefaultTicketStatuses, updateTicket } from '../src/modules/tickets/service';
import { createProcessTemplate, startProcessInstance } from '../src/modules/processes/service';
import { createProblem, getProblem, listProblems, updateProblem } from '../src/modules/problems/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Problem Management', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `prob-${tenantId.slice(0, 8)}`, name: 'Problem Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  it('creates a problem with a sequential number, starting UNDER_INVESTIGATION', async () => {
    const first = await createProblem(tenantId, { title: 'Intermittent VPN drops' });
    expect(first.status).toBe('UNDER_INVESTIGATION');
    expect(first.resolvedAt).toBeNull();
    const second = await createProblem(tenantId, { title: 'Slow email delivery' });
    expect(second.number).toBe(first.number + 1);
  });

  it('links tickets to a problem via the existing ticket PATCH, and lists them back', async () => {
    const problem = await createProblem(tenantId, { title: 'Printer driver crashes' });
    const ticketA = await createTicketFromApi(tenantId, {
      subject: 'Printer crashed again',
      body: 'body',
      contactEmail: 'a@example.com',
      contactName: 'A',
    });
    const ticketB = await createTicketFromApi(tenantId, {
      subject: 'Same printer, same crash',
      body: 'body',
      contactEmail: 'b@example.com',
      contactName: 'B',
    });

    await updateTicket(tenantId, ticketA.id, { problemId: problem.id });
    await updateTicket(tenantId, ticketB.id, { problemId: problem.id });

    const fetched = await getProblem(tenantId, problem.id);
    expect(fetched.tickets.map((t) => t.id).sort()).toEqual([ticketA.id, ticketB.id].sort());

    // Unlinking (problemId: null) must actually disconnect, not be a no-op.
    await updateTicket(tenantId, ticketA.id, { problemId: null });
    const afterUnlink = await getProblem(tenantId, problem.id);
    expect(afterUnlink.tickets.map((t) => t.id)).toEqual([ticketB.id]);
  });

  it('sets resolvedAt on the first transition into RESOLVED/CLOSED, and clears it on reopening', async () => {
    const problem = await createProblem(tenantId, { title: 'Disk fills up nightly' });

    const knownError = await updateProblem(tenantId, problem.id, {
      status: 'KNOWN_ERROR',
      rootCause: 'Log rotation misconfigured on the batch host.',
      workaround: 'Manually clear /var/log/batch weekly until fixed.',
    });
    expect(knownError.resolvedAt).toBeNull();

    const resolved = await updateProblem(tenantId, problem.id, { status: 'RESOLVED' });
    expect(resolved.resolvedAt).not.toBeNull();
    const firstResolvedAt = resolved.resolvedAt;

    // Moving CLOSED -> RESOLVED -> CLOSED again shouldn't push resolvedAt forward --
    // it's "when this was first resolved," not "when it was last touched."
    const closed = await updateProblem(tenantId, problem.id, { status: 'CLOSED' });
    expect(closed.resolvedAt).toEqual(firstResolvedAt);

    const reopened = await updateProblem(tenantId, problem.id, { status: 'UNDER_INVESTIGATION' });
    expect(reopened.resolvedAt).toBeNull();
  });

  it('optionally links the Change that shipped the fix, and rejects a nonexistent one', async () => {
    const problem = await createProblem(tenantId, { title: 'Firewall blocks legit traffic' });

    await expect(
      updateProblem(tenantId, problem.id, { changeInstanceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow('linked change instance not found');

    const changeTemplate = await createProcessTemplate(tenantId, {
      name: 'Firewall Fix Change',
      kind: 'CHANGE',
      steps: [{ label: 'CAB approval', requiresApproval: true }],
    });
    const change = await startProcessInstance(tenantId, changeTemplate.id, 'Widen the allowlist', { riskLevel: 'LOW' });

    const linked = await updateProblem(tenantId, problem.id, { changeInstanceId: change.id });
    expect(linked.changeInstance?.id).toBe(change.id);

    const fetched = await getProblem(tenantId, problem.id);
    expect(fetched.changeInstance?.subject).toBe('Widen the allowlist');
  });

  it('lists problems newest-number-first', async () => {
    const { problems } = await listProblems(tenantId);
    const numbers = problems.map((p) => p.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });
});
