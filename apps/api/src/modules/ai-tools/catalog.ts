import { z } from 'zod';
import { addMessage, getTicket, listTicketStatuses, updateTicket } from '../tickets/service';
import { applyMacro } from '../macros/service';

/**
 * The shared AI tool catalog (docs/adr/0033-ai-tool-catalog-and-autonomy.md): one
 * implementation per capability, reused by every AI actor -- the MCP server
 * (apps/mcp-server) today, a future autonomous copilot loop later. Every
 * `execute` is a thin wrapper over the exact same service-layer function a
 * human agent's own UI action already calls -- webhook dispatch, SLA
 * stamping, notification emails all happen for free, and an AI-driven action
 * can never drift from what a human clicking through the console would get.
 *
 * `mutating: false` tools (currently only get_ticket) never touch
 * AutonomyPolicy or AiAgentRun -- there is no side effect to gate or audit.
 *
 * `argsSchema` is specifically a ZodObject, not the more general ZodType --
 * apps/mcp-server registers each tool with the MCP SDK via its raw shape
 * (`argsSchema.shape`, a plain `{ field: ZodType }` record, not the wrapped
 * z.object(...) itself -- see the SDK's own registerTool examples), which only
 * a ZodObject exposes.
 */
export interface ToolDefinition<TArgs = unknown> {
  name: string;
  description: string;
  mutating: boolean;
  argsSchema: z.ZodObject<z.ZodRawShape, z.UnknownKeysParam, z.ZodTypeAny, TArgs>;
  execute: (tenantId: string, args: TArgs) => Promise<unknown>;
}

const getTicketArgs = z.object({ ticketId: z.string().uuid() });

const getTicketTool: ToolDefinition<z.infer<typeof getTicketArgs>> = {
  name: 'get_ticket',
  description: 'Fetch a ticket by id, including its message thread, contact, and current status.',
  mutating: false,
  argsSchema: getTicketArgs,
  execute: (tenantId, args) => getTicket(tenantId, args.ticketId),
};

const addTicketReplyArgs = z.object({
  ticketId: z.string().uuid(),
  body: z.string().min(1).max(20000),
  // Defaults to a public reply -- an internal note requires the caller to say so
  // explicitly, the same default direction as the UI's own reply box.
  isPrivateNote: z.boolean().optional(),
});

const addTicketReplyTool: ToolDefinition<z.infer<typeof addTicketReplyArgs>> = {
  name: 'add_ticket_reply',
  description: 'Post a reply or internal note on a ticket, authored by the AI agent.',
  mutating: true,
  argsSchema: addTicketReplyArgs,
  execute: (tenantId, args) =>
    addMessage(tenantId, args.ticketId, {
      authorType: 'AI',
      body: args.body,
      isPrivateNote: args.isPrivateNote ?? false,
    }),
};

const setTicketStatusArgs = z.object({ ticketId: z.string().uuid(), statusKey: z.string().min(1) });

const setTicketStatusTool: ToolDefinition<z.infer<typeof setTicketStatusArgs>> = {
  name: 'set_ticket_status',
  description:
    'Change a ticket\'s status by its key (e.g. "resolved", "pending") rather than its raw id -- call get_ticket first if unsure which keys this tenant uses.',
  mutating: true,
  argsSchema: setTicketStatusArgs,
  execute: async (tenantId, args) => {
    const statuses = await listTicketStatuses(tenantId);
    const status = statuses.find((s) => s.key === args.statusKey);
    if (!status) throw new Error(`no ticket status with key "${args.statusKey}"`);
    return updateTicket(tenantId, args.ticketId, { statusId: status.id });
  },
};

const assignTicketArgs = z.object({
  ticketId: z.string().uuid(),
  // null explicitly unassigns -- same shape as UpdateTicketInput.assigneeId.
  assigneeId: z.string().uuid().nullable(),
});

const assignTicketTool: ToolDefinition<z.infer<typeof assignTicketArgs>> = {
  name: 'assign_ticket',
  description: 'Assign a ticket to a specific agent (by user id), or pass null to unassign it.',
  mutating: true,
  argsSchema: assignTicketArgs,
  execute: (tenantId, args) => updateTicket(tenantId, args.ticketId, { assigneeId: args.assigneeId }),
};

const applyMacroArgs = z.object({ ticketId: z.string().uuid(), macroId: z.string().uuid() });

const applyMacroTool: ToolDefinition<z.infer<typeof applyMacroArgs>> = {
  name: 'apply_macro',
  description: 'Apply a tenant-defined macro (a bundle of status/priority/assignee changes and/or a canned reply) to a ticket.',
  mutating: true,
  argsSchema: applyMacroArgs,
  execute: (tenantId, args) => applyMacro(tenantId, args.ticketId, args.macroId, undefined, 'AI'),
};

const escalateToHumanArgs = z.object({ ticketId: z.string().uuid(), reason: z.string().min(1).max(2000) });

const escalateToHumanTool: ToolDefinition<z.infer<typeof escalateToHumanArgs>> = {
  name: 'escalate_to_human',
  description:
    'Hand a ticket off to a human agent when the AI cannot safely continue -- posts an internal note explaining why and clears the assignee so it surfaces in the unassigned queue.',
  mutating: true,
  argsSchema: escalateToHumanArgs,
  execute: async (tenantId, args) => {
    await addMessage(tenantId, args.ticketId, {
      authorType: 'AI',
      body: `Escalated to a human agent: ${args.reason}`,
      isPrivateNote: true,
    });
    return updateTicket(tenantId, args.ticketId, { assigneeId: null });
  },
};

// A heterogeneous registry of ToolDefinition<TArgs> for different TArgs has no
// sound narrower type than `any` here; every real call site validates args
// against the specific tool's own argsSchema before its typed execute() ever
// runs (see executor.ts), so this never bypasses actual validation.
export const TOOL_CATALOG: ToolDefinition<any>[] = [
  getTicketTool,
  addTicketReplyTool,
  setTicketStatusTool,
  assignTicketTool,
  applyMacroTool,
  escalateToHumanTool,
];

export function getToolDefinition(name: string): ToolDefinition<any> | undefined {
  return TOOL_CATALOG.find((t) => t.name === name);
}
