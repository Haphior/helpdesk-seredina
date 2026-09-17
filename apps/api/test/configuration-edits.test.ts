import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createCustomFieldDefinition, updateCustomFieldDefinition } from '../src/modules/customfields/service';
import { createServiceCatalogItem, updateServiceCatalogItem } from '../src/modules/servicecatalog/service';
import { createMacro, updateMacro } from '../src/modules/macros/service';
import { createWebhook, rotateWebhookSecret, updateWebhook } from '../src/modules/webhooks/service';
import { createProcessTemplate, updateProcessTemplate } from '../src/modules/processes/service';
import {
  createEscalationTier,
  createOnCallSchedule,
  renameOnCallSchedule,
  updateEscalationTier,
} from '../src/modules/oncall/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Configuration edits (review pass)', () => {
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `cfg-edits-${tenantId.slice(0, 8)}`, name: 'Config Edits' } });
      const user = await tx.user.create({ data: { tenantId, email: 'agent@example.com', name: 'Agent', passwordHash: 'x' } });
      userId = user.id;
    });
  });

  it('updateCustomFieldDefinition edits label/required/options and reorders, but never key/fieldType', async () => {
    const field = await createCustomFieldDefinition(tenantId, {
      key: 'shirt_size',
      label: 'Shirt size',
      fieldType: 'SELECT',
      options: ['S', 'M'],
    });
    const updated = await updateCustomFieldDefinition(tenantId, field.id, {
      label: 'T-shirt size',
      required: true,
      options: ['S', 'M', 'L', 'XL'],
      sortOrder: 5,
    });
    expect(updated.label).toBe('T-shirt size');
    expect(updated.required).toBe(true);
    expect(updated.options).toEqual(['S', 'M', 'L', 'XL']);
    expect(updated.sortOrder).toBe(5);
    expect(updated.key).toBe('shirt_size'); // immutable
    expect(updated.fieldType).toBe('SELECT'); // immutable
  });

  it('updateServiceCatalogItem edits fields and rejects renaming into a colliding name', async () => {
    const item = await createServiceCatalogItem(tenantId, { name: 'New laptop' });
    await createServiceCatalogItem(tenantId, { name: 'VPN access' });

    const updated = await updateServiceCatalogItem(tenantId, item.id, { description: 'Standard-issue laptop' });
    expect(updated.description).toBe('Standard-issue laptop');

    await expect(updateServiceCatalogItem(tenantId, item.id, { name: 'VPN access' })).rejects.toThrow(
      'a service catalog item with this name already exists',
    );
  });

  it('updateMacro edits name/actions and still requires at least one action', async () => {
    const macro = await createMacro(tenantId, { name: 'Escalate', actions: { setPriority: 'HIGH' } });
    const updated = await updateMacro(tenantId, macro.id, { actions: { setPriority: 'URGENT' } });
    expect((updated.actions as { setPriority?: string }).setPriority).toBe('URGENT');

    await expect(updateMacro(tenantId, macro.id, { actions: {} })).rejects.toThrow('a macro needs at least one action');
  });

  it('updateWebhook edits url/events/isActive without touching the secret; rotateWebhookSecret issues a new one', async () => {
    const created = await createWebhook(tenantId, { url: 'https://example.com/hook', events: ['ticket.created'] });
    const updated = await updateWebhook(tenantId, created.id, { events: ['ticket.created', 'ticket.updated'], isActive: false });
    expect(updated.events).toEqual(['ticket.created', 'ticket.updated']);
    expect(updated.isActive).toBe(false);
    expect(updated).not.toHaveProperty('secretEncrypted');

    const rotated = await rotateWebhookSecret(tenantId, created.id);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.secret).toHaveLength(64); // 32 bytes hex
  });

  it('updateProcessTemplate replaces steps safely without breaking an already-started instance', async () => {
    const template = await createProcessTemplate(tenantId, {
      name: 'Onboarding',
      steps: [{ label: 'Step 1' }, { label: 'Step 2' }],
    });

    const { startProcessInstance } = await import('../src/modules/processes/service');
    const instance = await startProcessInstance(tenantId, template.id, 'Onboard Jane', {});
    expect(instance.steps.map((s) => s.label)).toEqual(['Step 1', 'Step 2']);

    const updated = await updateProcessTemplate(tenantId, template.id, {
      name: 'Onboarding (revised)',
      steps: [{ label: 'New step A' }],
    });
    expect(updated.name).toBe('Onboarding (revised)');
    expect(updated.steps.map((s) => s.label)).toEqual(['New step A']);

    // The already-started instance keeps its own copied steps, untouched.
    const { getProcessInstance } = await import('../src/modules/processes/service');
    const stillRunning = await getProcessInstance(tenantId, instance.id);
    expect(stillRunning.steps.map((s) => s.label)).toEqual(['Step 1', 'Step 2']);
  });

  it('renameOnCallSchedule renames and rejects a colliding name', async () => {
    const schedule = await createOnCallSchedule(tenantId, 'Primary');
    await createOnCallSchedule(tenantId, 'Secondary');

    const renamed = await renameOnCallSchedule(tenantId, schedule.id, 'Primary IT');
    expect(renamed.name).toBe('Primary IT');

    await expect(renameOnCallSchedule(tenantId, schedule.id, 'Secondary')).rejects.toThrow(
      'an on-call schedule with this name already exists',
    );
  });

  it('updateEscalationTier edits minutes and reorders via sortOrder swap', async () => {
    const tierA = await createEscalationTier(tenantId, { userId, escalateAfterMinutes: 15 });
    const tierB = await createEscalationTier(tenantId, { userId, escalateAfterMinutes: 30 });

    const updated = await updateEscalationTier(tenantId, tierA.id, { escalateAfterMinutes: 20 });
    expect(updated.escalateAfterMinutes).toBe(20);

    // Swap sortOrder -- the same move-up/move-down pattern the UI uses.
    await Promise.all([
      updateEscalationTier(tenantId, tierA.id, { sortOrder: tierB.sortOrder }),
      updateEscalationTier(tenantId, tierB.id, { sortOrder: tierA.sortOrder }),
    ]);
    const { listEscalationTiers } = await import('../src/modules/oncall/service');
    const reordered = await listEscalationTiers(tenantId);
    expect(reordered.map((t) => t.id)).toEqual([tierB.id, tierA.id]);
  });
});
