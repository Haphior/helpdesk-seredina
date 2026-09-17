import { prisma, withTenantTx } from '@seredina/db';

// --- On-call schedules + shifts ---

export async function listOnCallSchedules(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.onCallSchedule.findMany({
      include: { shifts: { orderBy: { startsAt: 'asc' }, include: { user: { select: { id: true, name: true } } } } },
      orderBy: { name: 'asc' },
    }),
  );
}

export async function createOnCallSchedule(tenantId: string, name: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.onCallSchedule.findUnique({ where: { tenantId_name: { tenantId, name } } });
    if (existing) throw new Error('an on-call schedule with this name already exists');
    return tx.onCallSchedule.create({ data: { tenantId, name } });
  });
}

export async function deleteOnCallSchedule(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.onCallSchedule.findUnique({ where: { id } });
    if (!existing) throw new Error('on-call schedule not found');
    await tx.onCallSchedule.delete({ where: { id } });
  });
}

export interface AddShiftInput {
  userId: string;
  startsAt: Date;
  endsAt: Date;
}

export async function addShift(tenantId: string, scheduleId: string, input: AddShiftInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    if (input.endsAt <= input.startsAt) throw new Error('a shift must end after it starts');
    const schedule = await tx.onCallSchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) throw new Error('on-call schedule not found');
    return tx.onCallShift.create({
      data: { tenantId, scheduleId, userId: input.userId, startsAt: input.startsAt, endsAt: input.endsAt },
      include: { user: { select: { id: true, name: true } } },
    });
  });
}

export async function deleteShift(tenantId: string, shiftId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.onCallShift.findUnique({ where: { id: shiftId } });
    if (!existing) throw new Error('shift not found');
    await tx.onCallShift.delete({ where: { id: shiftId } });
  });
}

/** "Whoever's on shift right now" -- the first shift covering `at`, if any. */
export async function whoIsOnShift(tenantId: string, scheduleId: string, at: Date = new Date()) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.onCallShift.findFirst({
      where: { scheduleId, startsAt: { lte: at }, endsAt: { gt: at } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { startsAt: 'asc' },
    }),
  );
}

// --- Escalation chain (one ordered list per tenant, see schema comment) ---

export async function listEscalationTiers(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.escalationTier.findMany({
      include: { user: { select: { id: true, name: true } }, onCallSchedule: { select: { id: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
    }),
  );
}

export interface CreateEscalationTierInput {
  userId?: string | null;
  onCallScheduleId?: string | null;
  escalateAfterMinutes: number;
}

export async function createEscalationTier(tenantId: string, input: CreateEscalationTierInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const hasUser = Boolean(input.userId);
    const hasSchedule = Boolean(input.onCallScheduleId);
    if (hasUser === hasSchedule) throw new Error('a tier must notify exactly one of a user or an on-call schedule');
    if (input.escalateAfterMinutes <= 0) throw new Error('escalateAfterMinutes must be a positive number of minutes');

    const count = await tx.escalationTier.count();
    return tx.escalationTier.create({
      data: {
        tenantId,
        userId: input.userId ?? null,
        onCallScheduleId: input.onCallScheduleId ?? null,
        escalateAfterMinutes: input.escalateAfterMinutes,
        sortOrder: count,
      },
      include: { user: { select: { id: true, name: true } }, onCallSchedule: { select: { id: true, name: true } } },
    });
  });
}

export async function deleteEscalationTier(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.escalationTier.findUnique({ where: { id } });
    if (!existing) throw new Error('escalation tier not found');
    await tx.escalationTier.delete({ where: { id } });
  });
}

// --- Escalation runs (started by apps/worker on an SLA breach) ---

export async function getActiveEscalationForTicket(tenantId: string, ticketId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.escalationRun.findFirst({
      where: { ticketId },
      include: { acknowledgedByUser: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function acknowledgeEscalation(tenantId: string, ticketId: string, userId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const run = await tx.escalationRun.findFirst({ where: { ticketId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
    if (!run) throw new Error('no active escalation for this ticket');
    return tx.escalationRun.update({
      where: { id: run.id },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedByUserId: userId },
      include: { acknowledgedByUser: { select: { id: true, name: true } } },
    });
  });
}
