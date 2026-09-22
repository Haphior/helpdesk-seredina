import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import {
  createProcessTemplate,
  createTicketForProcessStep,
  deleteProcessTemplate,
  getProcessInstance,
  startProcessInstance,
  updateProcessStep,
} from '../src/modules/processes/service';
import { seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('IT processes', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `proc-${tenantId.slice(0, 8)}`, name: 'Process Test' } }),
    );
  });

  it('creates a template with ordered steps', async () => {
    const template = await createProcessTemplate(tenantId, {
      name: 'Employee Onboarding',
      steps: [{ label: 'Create accounts' }, { label: 'Assign equipment' }, { label: 'Manager sign-off', requiresApproval: true }],
    });
    expect(template.steps.map((s) => s.label)).toEqual(['Create accounts', 'Assign equipment', 'Manager sign-off']);
    expect(template.steps[2].requiresApproval).toBe(true);
  });

  it('rejects a duplicate template name and an empty step list', async () => {
    await expect(
      createProcessTemplate(tenantId, { name: 'Employee Onboarding', steps: [{ label: 'x' }] }),
    ).rejects.toThrow('a process template with this name already exists');
    await expect(createProcessTemplate(tenantId, { name: 'Empty', steps: [] })).rejects.toThrow(
      'a process template needs at least one step',
    );
  });

  it('starting an instance copies step labels/requiresApproval, independent of the template afterward', async () => {
    const template = await createProcessTemplate(tenantId, {
      name: 'Vendor Contract Approval',
      steps: [{ label: 'Legal review', requiresApproval: true }, { label: 'Sign contract' }],
    });
    const instance = await startProcessInstance(tenantId, template.id, 'Acme Corp contract');
    expect(instance.steps.map((s) => s.label)).toEqual(['Legal review', 'Sign contract']);
    expect(instance.steps[0].requiresApproval).toBe(true);
    expect(instance.templateName).toBe('Vendor Contract Approval');

    // Deleting the template afterward must not touch the running instance or its
    // steps -- the whole point of copying at creation time.
    await deleteProcessTemplate(tenantId, template.id);
    const stillThere = await getProcessInstance(tenantId, instance.id);
    expect(stillThere.steps).toHaveLength(2);
    expect(stillThere.processTemplateId).toBeNull();
    expect(stillThere.templateName).toBe('Vendor Contract Approval');
  });

  it('a step marked requiresApproval cannot be closed as plain DONE', async () => {
    const template = await createProcessTemplate(tenantId, {
      name: 'Needs Approval Test',
      steps: [{ label: 'Sign-off', requiresApproval: true }],
    });
    const instance = await startProcessInstance(tenantId, template.id, 'test instance');
    const stepId = instance.steps[0].id;

    await expect(updateProcessStep(tenantId, stepId, { status: 'DONE' })).rejects.toThrow(
      'this step requires approval -- use approved or rejected, not done',
    );
    // APPROVED is fine for the same step.
    const approved = await updateProcessStep(tenantId, stepId, { status: 'APPROVED' });
    expect(approved.status).toBe('APPROVED');
  });

  it('the instance auto-completes when its last step finishes, and auto-reopens if a step is reopened', async () => {
    const template = await createProcessTemplate(tenantId, {
      name: 'Two Step Test',
      steps: [{ label: 'Step A' }, { label: 'Step B' }],
    });
    const instance = await startProcessInstance(tenantId, template.id, 'two-step instance');
    const [stepA, stepB] = instance.steps;

    await updateProcessStep(tenantId, stepA.id, { status: 'DONE' });
    let fetched = await getProcessInstance(tenantId, instance.id);
    expect(fetched.status).toBe('IN_PROGRESS'); // one step still pending

    await updateProcessStep(tenantId, stepB.id, { status: 'DONE' });
    fetched = await getProcessInstance(tenantId, instance.id);
    expect(fetched.status).toBe('COMPLETED');

    // Reopening one step should un-complete the instance, not leave it stuck
    // showing COMPLETED with a pending step underneath.
    await updateProcessStep(tenantId, stepB.id, { status: 'PENDING' });
    fetched = await getProcessInstance(tenantId, instance.id);
    expect(fetched.status).toBe('IN_PROGRESS');
  });

  describe('Change Enablement', () => {
    it('a GENERAL template (the default kind) never requires a risk level', async () => {
      const template = await createProcessTemplate(tenantId, { name: 'Plain Process', steps: [{ label: 'Step 1' }] });
      expect(template.kind).toBe('GENERAL');
      const instance = await startProcessInstance(tenantId, template.id, 'no risk needed');
      expect(instance.riskLevel).toBeNull();
    });

    it('starting a CHANGE-kind template without a risk level is rejected', async () => {
      const template = await createProcessTemplate(tenantId, {
        name: 'Firewall Rule Change',
        kind: 'CHANGE',
        steps: [{ label: 'CAB approval', requiresApproval: true }, { label: 'Apply change' }],
      });
      await expect(startProcessInstance(tenantId, template.id, 'Open port 8443')).rejects.toThrow(
        'starting a change requires a risk level',
      );
    });

    it('a CHANGE instance stores its risk level and optional planned window/rollback plan', async () => {
      const template = await createProcessTemplate(tenantId, {
        name: 'Database Migration',
        kind: 'CHANGE',
        steps: [{ label: 'CAB approval', requiresApproval: true }, { label: 'Run migration' }],
      });
      const plannedStart = new Date('2026-02-01T02:00:00Z');
      const plannedEnd = new Date('2026-02-01T04:00:00Z');
      const instance = await startProcessInstance(tenantId, template.id, 'Migrate to Postgres 17', {
        riskLevel: 'HIGH',
        plannedStart,
        plannedEnd,
        rollbackPlan: 'Restore from the pre-migration snapshot.',
      });
      expect(instance.riskLevel).toBe('HIGH');
      expect(instance.plannedStart).toEqual(plannedStart);
      expect(instance.plannedEnd).toEqual(plannedEnd);
      expect(instance.rollbackPlan).toBe('Restore from the pre-migration snapshot.');
      // The approval-gated step already built for general processes works
      // unmodified for a Change's CAB sign-off -- no new mechanism needed.
      expect(instance.steps[0].requiresApproval).toBe(true);
    });

    it('a risk level provided against a GENERAL template is silently ignored, not stored', async () => {
      const template = await createProcessTemplate(tenantId, { name: 'Another Plain Process', steps: [{ label: 'Step 1' }] });
      const instance = await startProcessInstance(tenantId, template.id, 'has a risk level but should not keep it', {
        riskLevel: 'HIGH',
      });
      expect(instance.riskLevel).toBeNull();
    });
  });

  describe('Release Management', () => {
    it('starting a RELEASE-kind template without a version is rejected', async () => {
      const template = await createProcessTemplate(tenantId, {
        name: 'API Service Release',
        kind: 'RELEASE',
        steps: [{ label: 'Build' }, { label: 'Stage' }, { label: 'Deploy' }],
      });
      await expect(startProcessInstance(tenantId, template.id, 'ship it')).rejects.toThrow(
        'starting a release requires a version',
      );
    });

    it('a RELEASE instance stores its version, optional planned window/rollback plan, and an optional link back to the Change that approved it', async () => {
      const changeTemplate = await createProcessTemplate(tenantId, {
        name: 'Release Test Change',
        kind: 'CHANGE',
        steps: [{ label: 'CAB approval', requiresApproval: true }],
      });
      const change = await startProcessInstance(tenantId, changeTemplate.id, 'Approve v2.4.0 release', { riskLevel: 'MEDIUM' });

      const releaseTemplate = await createProcessTemplate(tenantId, {
        name: 'Web App Release',
        kind: 'RELEASE',
        steps: [{ label: 'Build' }, { label: 'Stage' }, { label: 'Deploy' }, { label: 'Confirm' }],
      });
      const plannedStart = new Date('2026-03-01T01:00:00Z');
      const release = await startProcessInstance(tenantId, releaseTemplate.id, 'Deploy v2.4.0', {
        releaseVersion: 'v2.4.0',
        changeInstanceId: change.id,
        plannedStart,
        rollbackPlan: 'Redeploy the previous container image.',
      });

      expect(release.releaseVersion).toBe('v2.4.0');
      expect(release.changeInstanceId).toBe(change.id);
      expect(release.plannedStart).toEqual(plannedStart);
      expect(release.rollbackPlan).toBe('Redeploy the previous container image.');
      expect(release.riskLevel).toBeNull(); // Release-kind, not Change-kind -- never set here
      expect(release.steps.map((s) => s.label)).toEqual(['Build', 'Stage', 'Deploy', 'Confirm']);
    });

    it('rejects a changeInstanceId that does not exist', async () => {
      const releaseTemplate = await createProcessTemplate(tenantId, {
        name: 'Bad Link Release',
        kind: 'RELEASE',
        steps: [{ label: 'Deploy' }],
      });
      await expect(
        startProcessInstance(tenantId, releaseTemplate.id, 'Deploy something', {
          releaseVersion: 'v1.0.0',
          changeInstanceId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow('linked change instance not found');
    });

    it('a release version provided against a GENERAL template is silently ignored, not stored', async () => {
      const template = await createProcessTemplate(tenantId, { name: 'Yet Another Plain Process', steps: [{ label: 'Step 1' }] });
      const instance = await startProcessInstance(tenantId, template.id, 'has a version but should not keep it', {
        releaseVersion: 'v9.9.9',
      });
      expect(instance.releaseVersion).toBeNull();
    });
  });

  describe('creating a ticket from a process step', () => {
    // Its own tenant, seeded with real ticket statuses -- createTicketForProcessStep
    // goes through createTicketFromApi, which needs an "open" status to exist.
    let ticketTenantId: string;
    let agentUserId: string;

    beforeAll(async () => {
      ticketTenantId = randomUUID();
      await withTenantTx(prisma, ticketTenantId, async (tx) => {
        await tx.tenant.create({ data: { id: ticketTenantId, slug: `proc-ticket-${ticketTenantId.slice(0, 8)}`, name: 'Process Ticket Test' } });
        await seedDefaultTicketStatuses(tx, ticketTenantId);
        const agent = await tx.user.create({ data: { tenantId: ticketTenantId, email: 'agent@example.com', name: 'Agent', passwordHash: 'x' } });
        agentUserId = agent.id;
      });
    });

    it('spawns a real ticket, links it to the step, and assigns both', async () => {
      const template = await createProcessTemplate(ticketTenantId, {
        name: 'Laptop Provisioning',
        steps: [{ label: 'Order laptop' }],
      });
      const instance = await startProcessInstance(ticketTenantId, template.id, 'New hire laptop');
      const stepId = instance.steps[0].id;

      const ticket = await createTicketForProcessStep(ticketTenantId, stepId, {
        subject: 'Order a laptop for the new hire',
        body: 'Standard-issue laptop, ship to the office.',
        contactName: 'New Hire',
        contactEmail: 'new-hire@example.com',
        assigneeId: agentUserId,
      });
      expect(ticket.subject).toBe('Order a laptop for the new hire');
      expect(ticket.assigneeId).toBe(agentUserId);
      expect(ticket.channel).toBe('agent');

      const step = await getProcessInstance(ticketTenantId, instance.id);
      expect(step.steps[0].ticketId).toBe(ticket.id);
      expect(step.steps[0].assigneeId).toBe(agentUserId);
    });

    it('rejects spawning a second ticket for a step that already has one linked', async () => {
      const template = await createProcessTemplate(ticketTenantId, {
        name: 'Single Ticket Step',
        steps: [{ label: 'Do the thing' }],
      });
      const instance = await startProcessInstance(ticketTenantId, template.id, 'test instance');
      const stepId = instance.steps[0].id;

      await createTicketForProcessStep(ticketTenantId, stepId, {
        subject: 'First ticket',
        body: 'body',
        contactName: 'Contact',
        contactEmail: 'contact@example.com',
      });

      await expect(
        createTicketForProcessStep(ticketTenantId, stepId, {
          subject: 'Second ticket',
          body: 'body',
          contactName: 'Contact',
          contactEmail: 'contact@example.com',
        }),
      ).rejects.toThrow('this step already has a linked ticket');
    });

    it('leaves the step assignee untouched when no assignee is given for the new ticket', async () => {
      const template = await createProcessTemplate(ticketTenantId, {
        name: 'Pre-Assigned Step',
        steps: [{ label: 'Do the thing' }],
      });
      const instance = await startProcessInstance(ticketTenantId, template.id, 'test instance');
      const stepId = instance.steps[0].id;
      await updateProcessStep(ticketTenantId, stepId, { assigneeId: agentUserId });

      await createTicketForProcessStep(ticketTenantId, stepId, {
        subject: 'Unassigned ticket',
        body: 'body',
        contactName: 'Contact',
        contactEmail: 'contact@example.com',
      });

      const fetched = await getProcessInstance(ticketTenantId, instance.id);
      expect(fetched.steps[0].assigneeId).toBe(agentUserId);
    });
  });
});
