import { prisma, withTenantTx, type AiAgentRunStatus, type Prisma } from '@seredina/db';
import { getToolDefinition } from './catalog';

export interface CreateAiAgentRunInput {
  toolName: string;
  args: unknown;
  status: AiAgentRunStatus;
  source: string;
  ticketId?: string;
  result?: unknown;
  errorMessage?: string;
}

export async function createAiAgentRun(tenantId: string, input: CreateAiAgentRunInput) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.aiAgentRun.create({
      data: {
        tenantId,
        ticketId: input.ticketId,
        toolName: input.toolName,
        args: input.args as Prisma.InputJsonValue,
        result: input.result === undefined ? undefined : (input.result as Prisma.InputJsonValue),
        status: input.status,
        source: input.source,
        errorMessage: input.errorMessage,
      },
    }),
  );
}

/** Used by the executor's per-tenant daily action cap -- see runTool() in executor.ts. */
export async function countExecutedRunsSince(tenantId: string, since: Date): Promise<number> {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.aiAgentRun.count({ where: { status: 'EXECUTED', createdAt: { gte: since } } }),
  );
}

export interface ListAiAgentRunsFilter {
  status?: AiAgentRunStatus;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export async function listAiAgentRuns(tenantId: string, filter: ListAiAgentRunsFilter = {}) {
  const take = Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const skip = filter.offset ?? 0;
  return withTenantTx(prisma, tenantId, async (tx) => {
    const where: Prisma.AiAgentRunWhereInput = { status: filter.status };
    const [runs, total] = await Promise.all([
      tx.aiAgentRun.findMany({
        where,
        include: {
          ticket: { select: { id: true, number: true, subject: true } },
          reviewedByUser: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      tx.aiAgentRun.count({ where }),
    ]);
    return { runs, total };
  });
}

/**
 * A human reviewing the approval queue: runs the tool NOW, for real, exactly
 * as the executor would have if the policy had allowed it up front -- approval
 * bypasses AutonomyPolicy.autoExecuteTools (that's the whole point of a manual
 * approval) but not the tool's own argsSchema/execute, so an approved action
 * gets identical behavior to an auto-executed one.
 */
export async function approveAiAgentRun(tenantId: string, id: string, reviewerUserId: string) {
  const run = await withTenantTx(prisma, tenantId, (tx) => tx.aiAgentRun.findUnique({ where: { id } }));
  if (!run) throw new Error('AI agent run not found');
  if (run.status !== 'PENDING_APPROVAL') throw new Error('this run is not pending approval');

  const tool = getToolDefinition(run.toolName);
  if (!tool) throw new Error(`unknown tool: ${run.toolName}`);

  // Re-validate against the tool's own schema rather than trusting the JSON
  // stored at creation time verbatim -- cheap, and guards against the (however
  // unlikely) case of a tool's argsSchema changing between when this run was
  // queued and when a human gets around to approving it.
  const parsed = tool.argsSchema.safeParse(run.args);
  if (!parsed.success) throw new Error(`stored arguments no longer match ${run.toolName}'s schema: ${parsed.error.message}`);

  let status: 'EXECUTED' | 'FAILED';
  let result: unknown;
  let errorMessage: string | undefined;
  try {
    result = await tool.execute(tenantId, parsed.data);
    status = 'EXECUTED';
  } catch (err) {
    status = 'FAILED';
    errorMessage = (err as Error).message;
  }

  const updated = await withTenantTx(prisma, tenantId, (tx) =>
    tx.aiAgentRun.update({
      where: { id },
      data: {
        status,
        result: result === undefined ? undefined : (result as Prisma.InputJsonValue),
        errorMessage,
        reviewedByUserId: reviewerUserId,
        reviewedAt: new Date(),
      },
    }),
  );

  if (status === 'FAILED') throw new Error(errorMessage);
  return updated;
}

export async function rejectAiAgentRun(tenantId: string, id: string, reviewerUserId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const run = await tx.aiAgentRun.findUnique({ where: { id } });
    if (!run) throw new Error('AI agent run not found');
    if (run.status !== 'PENDING_APPROVAL') throw new Error('this run is not pending approval');
    return tx.aiAgentRun.update({
      where: { id },
      data: { status: 'REJECTED', reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
    });
  });
}
