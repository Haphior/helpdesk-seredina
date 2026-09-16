import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import {
  createProcessTemplate,
  deleteProcessTemplate,
  getProcessInstance,
  startProcessInstance,
  updateProcessStep,
} from '../src/modules/processes/service';

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
});
