import { prisma, withTenantTx, type ProblemStatus } from '@seredina/db';

const TICKET_SUMMARY_SELECT = { id: true, number: true, subject: true, statusId: true } as const;

export async function listProblems(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.problem.findMany({
      include: { tickets: { select: TICKET_SUMMARY_SELECT } },
      orderBy: { number: 'desc' },
    }),
  );
}

export interface CreateProblemInput {
  title: string;
  description?: string | null;
}

export async function createProblem(tenantId: string, input: CreateProblemInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { lastProblemNumber: { increment: 1 } },
    });
    return tx.problem.create({
      data: {
        tenantId,
        number: tenant.lastProblemNumber,
        title: input.title,
        description: input.description ?? null,
      },
      include: { tickets: { select: TICKET_SUMMARY_SELECT } },
    });
  });
}

export async function getProblem(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const problem = await tx.problem.findUnique({
      where: { id },
      include: {
        tickets: { select: TICKET_SUMMARY_SELECT },
        changeInstance: { select: { id: true, subject: true } },
      },
    });
    if (!problem) throw new Error('problem not found');
    return problem;
  });
}

export interface UpdateProblemInput {
  title?: string;
  description?: string | null;
  status?: ProblemStatus;
  rootCause?: string | null;
  workaround?: string | null;
  changeInstanceId?: string | null;
}

const RESOLVED_STATUSES: ProblemStatus[] = ['RESOLVED', 'CLOSED'];

/**
 * `resolvedAt` tracks the status the same way Ticket.resolvedAt does: set the
 * first time the status lands on RESOLVED/CLOSED, cleared if it's ever moved
 * back to an unresolved status -- a Problem re-opened after a fix didn't hold
 * shouldn't keep showing a stale resolution timestamp.
 */
export async function updateProblem(tenantId: string, id: string, input: UpdateProblemInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const problem = await tx.problem.findUnique({ where: { id } });
    if (!problem) throw new Error('problem not found');

    if (input.changeInstanceId) {
      const changeInstance = await tx.processInstance.findUnique({ where: { id: input.changeInstanceId } });
      if (!changeInstance) throw new Error('linked change instance not found');
    }

    let resolvedAt = problem.resolvedAt;
    if (input.status) {
      const nowResolved = RESOLVED_STATUSES.includes(input.status);
      resolvedAt = nowResolved ? (problem.resolvedAt ?? new Date()) : null;
    }

    return tx.problem.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        status: input.status,
        rootCause: input.rootCause,
        workaround: input.workaround,
        changeInstanceId: input.changeInstanceId === undefined ? undefined : input.changeInstanceId,
        resolvedAt,
      },
      include: { tickets: { select: TICKET_SUMMARY_SELECT }, changeInstance: { select: { id: true, subject: true } } },
    });
  });
}
