import { prisma, withTenantTx } from '@seredina/db';

export interface CreateCustomFieldInput {
  key: string;
  label: string;
  fieldType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'SELECT';
  options?: string[];
  required?: boolean;
}

export async function listCustomFieldDefinitions(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) =>
    tx.customFieldDefinition.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  );
}

export async function createCustomFieldDefinition(tenantId: string, input: CreateCustomFieldInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.customFieldDefinition.findUnique({ where: { tenantId_key: { tenantId, key: input.key } } });
    if (existing) throw new Error('a custom field with this key already exists');

    const count = await tx.customFieldDefinition.count();
    return tx.customFieldDefinition.create({
      data: {
        tenantId,
        key: input.key,
        label: input.label,
        fieldType: input.fieldType,
        options: input.fieldType === 'SELECT' ? (input.options ?? []) : [],
        required: input.required ?? false,
        sortOrder: count,
      },
    });
  });
}

export async function deleteCustomFieldDefinition(tenantId: string, definitionId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.customFieldDefinition.findUnique({ where: { id: definitionId } });
    if (!existing) throw new Error('custom field not found');
    await tx.customFieldDefinition.delete({ where: { id: definitionId } });
  });
}

export interface UpdateCustomFieldInput {
  label?: string;
  required?: boolean;
  // SELECT only. Renaming/removing an option a ticket already has stored as its
  // value is the caller's problem the same way it already is elsewhere (see
  // customFields' orphaned-value handling on Ticket) -- this never touches
  // existing ticket data, just the option list new/edited values can pick from.
  options?: string[];
  sortOrder?: number;
}

/**
 * `key` and `fieldType` are deliberately never editable here -- `key` is how a
 * ticket's jsonb customFields blob references this definition, and `fieldType`
 * changing after values exist could leave stored values (e.g. a NUMBER) that no
 * longer match the field's own type (now BOOLEAN). Both would need a real data
 * migration, not a form field; delete-and-recreate-with-a-new-key is the
 * intentional escape hatch for those two.
 */
export async function updateCustomFieldDefinition(tenantId: string, id: string, input: UpdateCustomFieldInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.customFieldDefinition.findUnique({ where: { id } });
    if (!existing) throw new Error('custom field not found');
    return tx.customFieldDefinition.update({
      where: { id },
      data: {
        label: input.label,
        required: input.required,
        options: existing.fieldType === 'SELECT' ? input.options : undefined,
        sortOrder: input.sortOrder,
      },
    });
  });
}
