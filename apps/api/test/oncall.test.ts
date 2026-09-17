import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import {
  acknowledgeEscalation,
  addShift,
  createEscalationTier,
  createOnCallSchedule,
  deleteEscalationTier,
  deleteOnCallSchedule,
  deleteShift,
  getActiveEscalationForTicket,
  listEscalationTiers,
  listOnCallSchedules,
  whoIsOnShift,
} from '../src/modules/oncall/service';
import { createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('On-call scheduling + escalation', () => {
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `oncall-${tenantId.slice(0, 8)}`, name: 'On-Call Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      const user = await tx.user.create({ data: { tenantId, email: 'oncall-agent@example.com', name: 'On-Call Agent', passwordHash: 'x' } });
      userId = user.id;
    });
  });

  describe('schedules and shifts', () => {
    it('creates a schedule, rejects a duplicate name', async () => {
      await createOnCallSchedule(tenantId, 'Primary IT On-Call');
      await expect(createOnCallSchedule(tenantId, 'Primary IT On-Call')).rejects.toThrow(
        'an on-call schedule with this name already exists',
      );
    });

    it('adding a shift rejects an end before the start', async () => {
      const schedule = await createOnCallSchedule(tenantId, 'Backwards Shift Test');
      await expect(
        addShift(tenantId, schedule.id, { userId, startsAt: new Date('2026-01-02'), endsAt: new Date('2026-01-01') }),
      ).rejects.toThrow('a shift must end after it starts');
    });

    it('whoIsOnShift finds the shift covering "now", and returns null outside any shift', async () => {
      const schedule = await createOnCallSchedule(tenantId, 'Coverage Test');
      const now = new Date();
      await addShift(tenantId, schedule.id, {
        userId,
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 60_000),
      });

      const onShift = await whoIsOnShift(tenantId, schedule.id, now);
      expect(onShift?.userId).toBe(userId);

      const notOnShift = await whoIsOnShift(tenantId, schedule.id, new Date(now.getTime() + 3_600_000));
      expect(notOnShift).toBeNull();
    });

    it('deleting a shift removes only that shift; deleting a schedule cascades its shifts', async () => {
      const schedule = await createOnCallSchedule(tenantId, 'Delete Cascade Test');
      const shift = await addShift(tenantId, schedule.id, {
        userId,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
      });
      await deleteShift(tenantId, shift.id);
      expect(await whoIsOnShift(tenantId, schedule.id)).toBeNull();

      await deleteOnCallSchedule(tenantId, schedule.id);
      const schedules = await listOnCallSchedules(tenantId);
      expect(schedules.find((s) => s.id === schedule.id)).toBeUndefined();
    });
  });

  describe('escalation chain', () => {
    it('rejects a tier naming both a user and a schedule, or neither', async () => {
      const schedule = await createOnCallSchedule(tenantId, 'Tier Validation Schedule');
      await expect(createEscalationTier(tenantId, { userId, onCallScheduleId: schedule.id, escalateAfterMinutes: 10 })).rejects.toThrow(
        'a tier must notify exactly one of a user or an on-call schedule',
      );
      await expect(createEscalationTier(tenantId, { escalateAfterMinutes: 10 })).rejects.toThrow(
        'a tier must notify exactly one of a user or an on-call schedule',
      );
    });

    it('rejects a non-positive escalateAfterMinutes', async () => {
      await expect(createEscalationTier(tenantId, { userId, escalateAfterMinutes: 0 })).rejects.toThrow(
        'escalateAfterMinutes must be a positive number of minutes',
      );
    });

    it('appends tiers with increasing sortOrder, and delete removes just the one tier', async () => {
      const before = await listEscalationTiers(tenantId);
      const t1 = await createEscalationTier(tenantId, { userId, escalateAfterMinutes: 15 });
      const t2 = await createEscalationTier(tenantId, { userId, escalateAfterMinutes: 30 });
      expect(t2.sortOrder).toBeGreaterThan(t1.sortOrder);

      await deleteEscalationTier(tenantId, t1.id);
      const after = await listEscalationTiers(tenantId);
      expect(after.find((t) => t.id === t1.id)).toBeUndefined();
      expect(after.find((t) => t.id === t2.id)).toBeDefined();
      expect(after.length).toBe(before.length + 1);
    });
  });

  describe('escalation runs (acknowledge path -- start/advance are worker-side, see docs/adr/0020)', () => {
    it('acknowledging with no active run is rejected', async () => {
      const ticket = await createTicketFromApi(tenantId, {
        subject: 'No escalation yet',
        body: 'body',
        contactEmail: 'a@example.com',
        contactName: 'A',
      });
      await expect(acknowledgeEscalation(tenantId, ticket.id, userId)).rejects.toThrow('no active escalation for this ticket');
    });

    it('acknowledging an active run records who and when, and getActiveEscalationForTicket reflects it', async () => {
      const ticket = await createTicketFromApi(tenantId, {
        subject: 'Has an active escalation',
        body: 'body',
        contactEmail: 'a@example.com',
        contactName: 'A',
      });
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.escalationRun.create({ data: { tenantId, ticketId: ticket.id, currentTierIndex: 0 } }),
      );

      const acked = await acknowledgeEscalation(tenantId, ticket.id, userId);
      expect(acked.status).toBe('ACKNOWLEDGED');
      expect(acked.acknowledgedByUser?.id).toBe(userId);

      const fetched = await getActiveEscalationForTicket(tenantId, ticket.id);
      expect(fetched?.status).toBe('ACKNOWLEDGED');

      // Already acknowledged -- a second attempt has no active run left to acknowledge.
      await expect(acknowledgeEscalation(tenantId, ticket.id, userId)).rejects.toThrow('no active escalation for this ticket');
    });
  });
});
