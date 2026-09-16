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
