import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { getTicket, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { ingestGrafanaAlert } from '../src/modules/integrations/grafana';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Grafana alert integration (Phase 4)', () => {
  let tenantId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `grafana-${tenantId.slice(0, 8)}`, name: 'Grafana Test Tenant' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  it('uses the payload\'s own title/message when present', async () => {
    const ticket = await ingestGrafanaAlert(tenantId, {
      status: 'firing',
      title: 'Disk usage high on db-1',
      message: 'Disk usage is at 92% on db-1, threshold is 90%.',
      groupKey: 'group-1',
    });

    const full = await getTicket(tenantId, ticket.id);
    expect(full.subject).toBe('Disk usage high on db-1');
    expect(full.messages[0].body).toBe('Disk usage is at 92% on db-1, threshold is 90%.');
    expect(full.contact.name).toBe('Grafana');
  });

  it('falls back to a synthesized title/description when Grafana sends no custom template', async () => {
    const ticket = await ingestGrafanaAlert(tenantId, {
      status: 'firing',
      commonLabels: { alertname: 'HighMemoryUsage' },
      commonAnnotations: { summary: 'Memory usage above 90% for 5 minutes' },
      alerts: [{ status: 'firing' }],
    });

    const full = await getTicket(tenantId, ticket.id);
    expect(full.subject).toBe('[FIRING] HighMemoryUsage');
    expect(full.messages[0].body).toContain('summary: Memory usage above 90% for 5 minutes');
    expect(full.messages[0].body).toContain('1 alert(s) in this group');
  });

  it('maps the common severity label onto the normalized 5-value scale', async () => {
    const ticket = await ingestGrafanaAlert(tenantId, {
      status: 'firing',
      title: 'Critical alert',
      commonLabels: { severity: 'critical' },
    });
    const full = await getTicket(tenantId, ticket.id);
    expect(full.priority).toBe('URGENT'); // CRITICAL -> URGENT per SEVERITY_TO_PRIORITY
  });

  it('defaults to NORMAL priority when no severity label is present', async () => {
    const ticket = await ingestGrafanaAlert(tenantId, { status: 'firing', title: 'No severity label' });
    const full = await getTicket(tenantId, ticket.id);
    expect(full.priority).toBe('NORMAL');
  });

  it('a second firing call with the same groupKey folds into the still-open ticket, not a new one', async () => {
    const first = await ingestGrafanaAlert(tenantId, { status: 'firing', title: 'Flapping alert', groupKey: 'flap-group' });
    const second = await ingestGrafanaAlert(tenantId, { status: 'firing', title: 'Flapping alert', groupKey: 'flap-group' });

    expect(second.id).toBe(first.id);
    const full = await getTicket(tenantId, first.id);
    expect(full.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('a resolved call for the same group is recorded as a message on the existing ticket, not silently dropped', async () => {
    const opened = await ingestGrafanaAlert(tenantId, { status: 'firing', title: 'Will resolve', groupKey: 'resolve-group' });
    await ingestGrafanaAlert(tenantId, {
      status: 'resolved',
      title: 'Will resolve',
      message: 'Alert cleared.',
      groupKey: 'resolve-group',
    });

    // ingestAlert's own re-fire message wraps the description as
    // "Alert re-triggered by <source>: <title>\n\n<description>" -- not the
    // raw description alone, so this checks containment.
    const full = await getTicket(tenantId, opened.id);
    expect(full.messages.some((m) => m.body.includes('Alert cleared.'))).toBe(true);
    expect(full.messages.some((m) => m.body.startsWith('Alert re-triggered by Grafana'))).toBe(true);
  });
});
