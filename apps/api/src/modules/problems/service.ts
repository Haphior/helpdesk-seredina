import { prisma, withTenantTx, type Prisma, type ProblemStatus } from '@seredina/db';

const TICKET_SUMMARY_SELECT = { id: true, number: true, subject: true, statusId: true } as const;
const OWNER_SELECT = { id: true, name: true } as const;

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface ListProblemsFilter {
  status?: ProblemStatus;
  limit?: number;
  offset?: number;
}

export async function listProblems(tenantId: string, filter: ListProblemsFilter = {}) {
  const limit = Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset = filter.offset ?? 0;
  const where: Prisma.ProblemWhereInput = { status: filter.status };

  return withTenantTx(prisma, tenantId, async (tx) => {
    const [problems, total] = await Promise.all([
      tx.problem.findMany({
        where,
        include: { tickets: { select: TICKET_SUMMARY_SELECT }, owner: { select: OWNER_SELECT } },
        orderBy: { number: 'desc' },
        take: limit,
        skip: offset,
      }),
      tx.problem.count({ where }),
    ]);
    return { problems, total };
  });
}

export interface CreateProblemInput {
  title: string;
  description?: string | null;
  ownerId?: string | null;
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
        ownerId: input.ownerId ?? null,
      },
      include: { tickets: { select: TICKET_SUMMARY_SELECT }, owner: { select: OWNER_SELECT } },
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
        owner: { select: OWNER_SELECT },
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
  ownerId?: string | null;
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
        ownerId: input.ownerId === undefined ? undefined : input.ownerId,
        resolvedAt,
      },
      include: {
        tickets: { select: TICKET_SUMMARY_SELECT },
        changeInstance: { select: { id: true, subject: true } },
        owner: { select: OWNER_SELECT },
      },
    });
  });
}
