import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LlmMessage, LlmProviderAdapter, ToolResult, ToolSpec } from '@seredina/ai-adapters';
import { logAiUsage } from '../ai/service';
import { TOOL_CATALOG } from './catalog';
import { runTool } from './executor';

// zod-to-json-schema's own declared signature is generic enough (combined
// with zod 3.25's own recursive types) that passing ANY real zod schema into
// it directly makes TS blow up with "type instantiation is excessively deep"
// -- confirmed as a genuine zod-to-json-schema/zod version friction, not a
// bug in this file's own types (reproduced with a trivial `z.object({...})`
// in isolation). Re-declaring the function's shape as non-generic here is a
// type-level-only workaround; the actual runtime call is unaffected.
const toJsonSchema = zodToJsonSchema as (schema: unknown) => Record<string, unknown>;

// A hard cap on tool calls per invocation -- the roadmap's "action caps" for
// autonomous mode. Not per-tenant-per-day (that's AutonomyPolicy.maxActionsPerDay,
// enforced inside runTool itself); this is a narrower, per-*run* guard against
// one ticket's own loop spinning forever, independent of whether the tenant's
// daily cap has room left.
const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are an autonomous IT helpdesk agent. You have tools to inspect and act on
a specific ticket. Start with get_ticket to see the full thread before doing anything else. Only
take an action (reply, change status, assign, apply a macro) if you are genuinely confident it is
correct and safe -- if you are unsure, or the request needs a human's judgment call, call
escalate_to_human with a clear reason instead of guessing. Some actions may come back as "pending
approval" rather than a real result -- that means a human has to approve it, which is expected and
not an error; do not retry the same action. When you are finished (resolved, escalated, or you have
nothing more useful to do), reply with a short plain-text summary of what you did and why, with no
further tool calls.`;

function buildToolSpecs(): ToolSpec[] {
  return TOOL_CATALOG.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t.argsSchema),
  }));
}

export interface AutonomousLoopStep {
  iteration: number;
  toolCalls: { name: string; input: unknown; result: unknown }[];
}

export interface AutonomousLoopResult {
  summary: string;
  steps: AutonomousLoopStep[];
  stoppedReason: 'completed' | 'max_iterations';
}

/**
 * The actual "autonomous mode" the roadmap called for: Seredina's own LLM
 * adapter decides which catalog tools to call, in a loop, rather than a human
 * or an external MCP agent deciding one call at a time (see
 * docs/adr/0033-ai-tool-catalog-and-autonomy.md for that path, and
 * docs/adr/0034-second-llm-provider-and-autonomous-loop.md for this one).
 * Every tool call, regardless of who/what is calling it, goes through the
 * SAME runTool() executor -- so this loop gets AutonomyPolicy gating and
 * AiAgentRun auditing for free, with `source: 'autonomous'` distinguishing
 * these runs from MCP-sourced ones in the activity log.
 */
export async function runAutonomousLoop(
  tenantId: string,
  ticketId: string,
  adapter: LlmProviderAdapter,
): Promise<AutonomousLoopResult> {
  const tools = buildToolSpecs();
  const messages: LlmMessage[] = [
    { role: 'user', content: `Please investigate and, if you safely can, resolve ticket ${ticketId}.` },
  ];
  const steps: AutonomousLoopStep[] = [];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const result = await adapter.complete({ system: SYSTEM_PROMPT, messages, tools, maxTokens: 1024 });
    await logAiUsage(tenantId, ticketId, 'autonomous_loop', result);

    if (result.stopReason !== 'tool_use' || !result.toolCalls?.length) {
      return { summary: result.text, steps, stoppedReason: 'completed' };
    }

    messages.push({ role: 'assistant', toolCalls: result.toolCalls });

    const stepCalls: AutonomousLoopStep['toolCalls'] = [];
    const toolResults: ToolResult[] = [];

    for (const call of result.toolCalls) {
      try {
        const runResult = await runTool(tenantId, call.name, call.input, { source: 'autonomous', ticketId });
        const payload = runResult.status === 'executed' ? runResult.result : { pendingApproval: true, reason: runResult.reason };
        stepCalls.push({ name: call.name, input: call.input, result: payload });
        toolResults.push({ toolCallId: call.id, content: JSON.stringify(payload) });
      } catch (err) {
        const message = (err as Error).message;
        stepCalls.push({ name: call.name, input: call.input, result: { error: message } });
        toolResults.push({ toolCallId: call.id, content: `Error: ${message}`, isError: true });
      }
    }

    steps.push({ iteration, toolCalls: stepCalls });
    messages.push({ role: 'tool_results', results: toolResults });
  }

  return {
    summary: 'Stopped after reaching the maximum number of tool calls for a single run.',
    steps,
    stoppedReason: 'max_iterations',
  };
}
