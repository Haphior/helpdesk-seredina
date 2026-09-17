import { prisma, withTenantTx, type Prisma, type TicketPriority } from '@seredina/db';
import { addMessage, updateTicket } from '../tickets/service';

/**
 * The typed action union, stored as jsonb on Macro.actions -- every field
 * optional, a macro applies only the ones it set. Deliberately not arbitrary
 * code: adding a new capability means adding a field here and a branch in
 * applyMacro, never letting a tenant supply logic that runs inside this process.
 */
export interface MacroActions {
  setStatusId?: string;
  setPriority?: TicketPriority;
  setTeamId?: string | null;
  setAssigneeId?: string | null;
  addReply?: { body: string; isPrivateNote: boolean };
}

export interface CreateMacroInput {
  name: string;
  actions: MacroActions;
}

function hasAnyAction(actions: MacroActions): boolean {
  return (
    actions.setStatusId !== undefined ||
    actions.setPriority !== undefined ||
    actions.setTeamId !== undefined ||
    actions.setAssigneeId !== undefined ||
    !!actions.addReply
  );
}

export async function listMacros(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) => tx.macro.findMany({ orderBy: { name: 'asc' } }));
}

export async function createMacro(tenantId: string, input: CreateMacroInput) {
  if (!hasAnyAction(input.actions)) {
    throw new Error('a macro needs at least one action');
  }
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.macro.findUnique({ where: { tenantId_name: { tenantId, name: input.name } } });
    if (existing) throw new Error('a macro with this name already exists');
    return tx.macro.create({ data: { tenantId, name: input.name, actions: input.actions as Prisma.InputJsonValue } });
  });
}

export async function deleteMacro(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.macro.findUnique({ where: { id } });
    if (!existing) throw new Error('macro not found');
    await tx.macro.delete({ where: { id } });
  });
}

export interface UpdateMacroInput {
  name?: string;
  actions?: MacroActions;
}

export async function updateMacro(tenantId: string, id: string, input: UpdateMacroInput) {
  if (input.actions && !hasAnyAction(input.actions)) {
    throw new Error('a macro needs at least one action');
  }
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.macro.findUnique({ where: { id } });
    if (!existing) throw new Error('macro not found');
    if (input.name && input.name !== existing.name) {
      const nameTaken = await tx.macro.findUnique({ where: { tenantId_name: { tenantId, name: input.name } } });
      if (nameTaken) throw new Error('a macro with this name already exists');
    }
    return tx.macro.update({
      where: { id },
      data: {
        name: input.name,
        actions: input.actions ? (input.actions as Prisma.InputJsonValue) : undefined,
      },
    });
  });
}

/**
 * Reuses updateTicket/addMessage rather than duplicating their logic -- a
 * macro's effects get webhook dispatch, resolvedAt/closedAt stamping, and
 * everything else those functions already do, for free, and can never drift
 * from what a human clicking through the UI one field at a time would get.
 */
export async function applyMacro(tenantId: string, ticketId: string, macroId: string, authorUserId: string) {
  const macro = await withTenantTx(prisma, tenantId, (tx) => tx.macro.findUnique({ where: { id: macroId } }));
  if (!macro) throw new Error('macro not found');

  const actions = macro.actions as MacroActions;

  const hasFieldUpdate =
    actions.setStatusId !== undefined ||
    actions.setPriority !== undefined ||
    actions.setTeamId !== undefined ||
    actions.setAssigneeId !== undefined;

  if (hasFieldUpdate) {
    await updateTicket(tenantId, ticketId, {
      statusId: actions.setStatusId,
      priority: actions.setPriority,
      teamId: actions.setTeamId,
      assigneeId: actions.setAssigneeId,
    });
  }

  if (actions.addReply) {
    await addMessage(tenantId, ticketId, {
      authorUserId,
      body: actions.addReply.body,
      isPrivateNote: actions.addReply.isPrivateNote,
    });
  }
}
