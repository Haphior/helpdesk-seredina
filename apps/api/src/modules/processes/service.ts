import { prisma, withTenantTx, type ProcessStepStatus } from '@seredina/db';

export interface StepTemplateInput {
  label: string;
  teamId?: string | null;
  requiresApproval?: boolean;
}

export interface CreateProcessTemplateInput {
  name: string;
  description?: string | null;
  steps: StepTemplateInput[];
}

export async function listProcessTemplates(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.processTemplate.findMany({
      include: { steps: { orderBy: { sortOrder: 'asc' }, include: { team: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function createProcessTemplate(tenantId: string, input: CreateProcessTemplateInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.processTemplate.findUnique({ where: { tenantId_name: { tenantId, name: input.name } } });
    if (existing) throw new Error('a process template with this name already exists');
    if (input.steps.length === 0) throw new Error('a process template needs at least one step');

    return tx.processTemplate.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        steps: {
          create: input.steps.map((s, i) => ({
            tenantId,
            label: s.label,
            teamId: s.teamId ?? null,
            requiresApproval: s.requiresApproval ?? false,
            sortOrder: i,
          })),
        },
      },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
  });
}

export async function deleteProcessTemplate(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.processTemplate.findUnique({ where: { id } });
    if (!existing) throw new Error('process template not found');
    // Cascades to its step templates only (schema); any spawned instances keep
    // their own copied step data and just lose the back-link -- see schema
    // comments on ProcessInstance.processTemplateId.
    await tx.processTemplate.delete({ where: { id } });
  });
}

export async function listProcessInstances(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.processInstance.findMany({
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function getProcessInstance(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const instance = await tx.processInstance.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { sortOrder: 'asc' },
          include: { assignee: { select: { id: true, name: true } }, ticket: { select: { id: true, number: true, subject: true } } },
        },
      },
    });
    if (!instance) throw new Error('process instance not found');
    return instance;
  });
}

export async function startProcessInstance(tenantId: string, templateId: string, subject: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const template = await tx.processTemplate.findUnique({
      where: { id: templateId },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new Error('process template not found');

    return tx.processInstance.create({
      data: {
        tenantId,
        processTemplateId: template.id,
        templateName: template.name,
        subject,
        steps: {
          create: template.steps.map((s) => ({
            tenantId,
            label: s.label,
            sortOrder: s.sortOrder,
            requiresApproval: s.requiresApproval,
          })),
        },
      },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
  });
}

export interface UpdateStepInput {
  status?: ProcessStepStatus;
  assigneeId?: string | null;
  ticketId?: string | null;
}

/**
 * A step whose template marked it requiresApproval can't jump straight to DONE --
 * it must land on APPROVED or REJECTED, so an approval step can't be silently
 * treated the same as a step nobody needed to sign off on.
 */
export async function updateProcessStep(tenantId: string, stepId: string, input: UpdateStepInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const step = await tx.processStepInstance.findUnique({ where: { id: stepId } });
    if (!step) throw new Error('process step not found');

    if (input.status === 'DONE' && step.requiresApproval) {
      throw new Error('this step requires approval -- use approved or rejected, not done');
    }

    const isTerminal = input.status === 'DONE' || input.status === 'APPROVED' || input.status === 'REJECTED' || input.status === 'SKIPPED';

    const updated = await tx.processStepInstance.update({
      where: { id: stepId },
      data: {
        status: input.status,
        assigneeId: input.assigneeId,
        ticketId: input.ticketId,
        completedAt: input.status ? (isTerminal ? new Date() : null) : undefined,
      },
    });

    // Auto-complete the parent instance once every step has reached a terminal
    // state -- a process shouldn't need a separate manual "mark instance done"
    // action when its last step just finished. Symmetric the other way too: if a
    // completed instance's step gets reopened, the instance goes back to
    // IN_PROGRESS rather than staying stuck showing "completed" with a pending
    // step underneath it.
    const allSteps = await tx.processStepInstance.findMany({ where: { processInstanceId: step.processInstanceId } });
    const allTerminal = allSteps.every((s) => ['DONE', 'APPROVED', 'REJECTED', 'SKIPPED'].includes(s.status));
    await tx.processInstance.update({
      where: { id: step.processInstanceId },
      data: allTerminal
        ? { status: 'COMPLETED', completedAt: new Date() }
        : { status: 'IN_PROGRESS', completedAt: null },
    });

    return updated;
  });
}
