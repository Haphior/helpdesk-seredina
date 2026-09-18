import { getToolDefinition } from './catalog';
import { getAutonomyPolicy } from './policy';
import { countExecutedRunsSince, createAiAgentRun } from './agentRuns';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface RunToolOptions {
  /** Which caller invoked the catalog -- 'mcp' today; see AiAgentRun.source in schema.prisma. */
  source: string;
  ticketId?: string;
}

export type RunToolResult =
  | { status: 'executed'; runId: string; result: unknown }
  | { status: 'pending_approval'; runId: string; reason: string };

/**
 * The single entry point every AI actor (apps/mcp-server, and later an
 * autonomous copilot loop) goes through to invoke a catalog tool -- never
 * calling a tool's own `execute` directly, which is what makes AutonomyPolicy
 * and the AiAgentRun audit trail apply uniformly regardless of which actor is
 * asking. See docs/adr/0033-ai-tool-catalog-and-autonomy.md.
 */
export async function runTool(tenantId: string, toolName: string, rawArgs: unknown, options: RunToolOptions): Promise<RunToolResult> {
  const tool = getToolDefinition(toolName);
  if (!tool) throw new Error(`unknown tool: ${toolName}`);

  const parsed = tool.argsSchema.safeParse(rawArgs);
  if (!parsed.success) throw new Error(`invalid arguments for ${toolName}: ${parsed.error.message}`);
  const args = parsed.data;

  // Read-only tools have no side effect to gate or audit -- executing get_ticket
  // a thousand times a day isn't a risk AutonomyPolicy exists to manage.
  if (!tool.mutating) {
    const result = await tool.execute(tenantId, args);
    return { status: 'executed', runId: '', result };
  }

  const policy = await getAutonomyPolicy(tenantId);
  const allowed = policy.autoExecuteTools.includes(toolName);

  if (!allowed) {
    const run = await createAiAgentRun(tenantId, {
      toolName,
      args,
      status: 'PENDING_APPROVAL',
      source: options.source,
      ticketId: options.ticketId,
    });
    return { status: 'pending_approval', runId: run.id, reason: `"${toolName}" is not on this tenant's auto-execute list` };
  }

  const executedToday = await countExecutedRunsSince(tenantId, new Date(Date.now() - ONE_DAY_MS));
  if (executedToday >= policy.maxActionsPerDay) {
    const run = await createAiAgentRun(tenantId, {
      toolName,
      args,
      status: 'PENDING_APPROVAL',
      source: options.source,
      ticketId: options.ticketId,
    });
    return { status: 'pending_approval', runId: run.id, reason: `daily auto-execute cap of ${policy.maxActionsPerDay} actions reached` };
  }

  try {
    const result = await tool.execute(tenantId, args);
    const run = await createAiAgentRun(tenantId, {
      toolName,
      args,
      status: 'EXECUTED',
      result,
      source: options.source,
      ticketId: options.ticketId,
    });
    return { status: 'executed', runId: run.id, result };
  } catch (err) {
    await createAiAgentRun(tenantId, {
      toolName,
      args,
      status: 'FAILED',
      source: options.source,
      ticketId: options.ticketId,
      errorMessage: (err as Error).message,
    });
    throw err;
  }
}
