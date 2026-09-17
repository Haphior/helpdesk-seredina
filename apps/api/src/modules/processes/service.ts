import {
  prisma,
  withTenantTx,
  type ChangeRiskLevel,
  type Prisma,
  type ProcessInstanceStatus,
  type ProcessStepStatus,
  type ProcessTemplateKind,
} from '@seredina/db';

export interface StepTemplateInput {
  label: string;
  teamId?: string | null;
  requiresApproval?: boolean;
}

export interface CreateProcessTemplateInput {
  name: string;
  description?: string | null;
  kind?: ProcessTemplateKind;
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
        kind: input.kind ?? 'GENERAL',
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

export interface UpdateProcessTemplateInput {
  name?: string;
  description?: string | null;
  steps?: StepTemplateInput[];
}

/**
 * `kind` is deliberately never editable -- switching an existing GENERAL
 * template to CHANGE/RELEASE after the fact would retroactively demand
 * fields (riskLevel, a version) that already-started instances never had a
 * chance to supply. A new template is the correct way to change kind.
 *
 * Steps, when provided, fully replace the existing set (delete + recreate)
 * rather than diffing -- safe because ProcessStepInstance copies its label/
 * sortOrder/requiresApproval at instance-creation time and holds no FK back
 * to ProcessStepTemplate (see schema.prisma's comment on ProcessStepInstance),
 * so an already-running process instance is completely unaffected by editing
 * the template it was started from.
 */
export async function updateProcessTemplate(tenantId: string, id: string, input: UpdateProcessTemplateInput) {
  if (input.steps && input.steps.length === 0) {
    throw new Error('a process template needs at least one step');
  }
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.processTemplate.findUnique({ where: { id } });
    if (!existing) throw new Error('process template not found');
    if (input.name && input.name !== existing.name) {
      const nameTaken = await tx.processTemplate.findUnique({ where: { tenantId_name: { tenantId, name: input.name } } });
      if (nameTaken) throw new Error('a process template with this name already exists');
    }

    if (input.steps) {
      await tx.processStepTemplate.deleteMany({ where: { processTemplateId: id } });
    }

    return tx.processTemplate.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        steps: input.steps
          ? {
              create: input.steps.map((s, i) => ({
                tenantId,
                label: s.label,
                teamId: s.teamId ?? null,
                requiresApproval: s.requiresApproval ?? false,
                sortOrder: i,
              })),
            }
          : undefined,
      },
      include: { steps: { orderBy: { sortOrder: 'asc' }, include: { team: true } } },
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

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface ListProcessInstancesFilter {
  status?: ProcessInstanceStatus;
  limit?: number;
  offset?: number;
}

export async function listProcessInstances(tenantId: string, filter: ListProcessInstancesFilter = {}) {
  const limit = Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset = filter.offset ?? 0;
  const where: Prisma.ProcessInstanceWhereInput = { status: filter.status };

  return withTenantTx(prisma, tenantId, async (tx) => {
    const [instances, total] = await Promise.all([
      tx.processInstance.findMany({
        where,
        include: { steps: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      tx.processInstance.count({ where }),
    ]);
    return { instances, total };
  });
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
        changeInstance: { select: { id: true, subject: true } },
      },
    });
    if (!instance) throw new Error('process instance not found');
    return instance;
  });
}

/**
 * Covers both Change and Release fields in one shape -- plannedStart/
 * plannedEnd/rollbackPlan are shared (see schema comment), riskLevel is
 * Change-only, releaseVersion/changeInstanceId are Release-only. Which ones
 * are required/stored depends on the template's kind, checked below.
 */
export interface StartProcessOptions {
  riskLevel?: ChangeRiskLevel;
  releaseVersion?: string | null;
  changeInstanceId?: string | null;
  plannedStart?: Date | null;
  plannedEnd?: Date | null;
  rollbackPlan?: string | null;
}

/**
 * `options.riskLevel` is required when `template.kind === 'CHANGE'`, and
 * `options.releaseVersion` when it's `RELEASE` -- a Change without a risk
 * assessment, or a Release with no identified version, isn't following the
 * practice it's named after, so both are enforced here rather than left as
 * fields nobody fills in. Every Change/Release column is ignored (never
 * stored) for a GENERAL template, since they're null for every ordinary
 * process instance by design -- see docs/adr/0013-change-enablement.md and
 * docs/adr/0014-release-management.md.
 */
export async function startProcessInstance(tenantId: string, templateId: string, subject: string, options?: StartProcessOptions) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const template = await tx.processTemplate.findUnique({
      where: { id: templateId },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new Error('process template not found');
    if (template.kind === 'CHANGE' && !options?.riskLevel) {
      throw new Error('starting a change requires a risk level');
    }
    if (template.kind === 'RELEASE' && !options?.releaseVersion) {
      throw new Error('starting a release requires a version');
    }
    if (options?.changeInstanceId) {
      const changeInstance = await tx.processInstance.findUnique({ where: { id: options.changeInstanceId } });
      if (!changeInstance) throw new Error('linked change instance not found');
    }

    let kindFields: Record<string, unknown> = {};
    if (template.kind === 'CHANGE') {
      kindFields = {
        riskLevel: options!.riskLevel,
        plannedStart: options?.plannedStart ?? null,
        plannedEnd: options?.plannedEnd ?? null,
        rollbackPlan: options?.rollbackPlan ?? null,
      };
    } else if (template.kind === 'RELEASE') {
      kindFields = {
        releaseVersion: options!.releaseVersion,
        changeInstanceId: options?.changeInstanceId ?? null,
        plannedStart: options?.plannedStart ?? null,
        plannedEnd: options?.plannedEnd ?? null,
        rollbackPlan: options?.rollbackPlan ?? null,
      };
    }

    return tx.processInstance.create({
      data: {
        tenantId,
        processTemplateId: template.id,
        templateName: template.name,
        subject,
        ...kindFields,
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
