import { prisma, withTenantTx, type Prisma } from '@seredina/db';
import type { EscalationAdvanceJobPayload } from '@seredina/shared';
import { escalationAdvanceQueue } from '../lib/queue';

type Tier = { userId: string | null; onCallScheduleId: string | null };

/** Resolves what to write into the system note for a tier: a fixed person, or whoever's on shift right now. */
async function describeTier(tx: Prisma.TransactionClient, tier: Tier): Promise<string> {
  if (tier.userId) {
    const user = await tx.user.findUnique({ where: { id: tier.userId } });
    return user?.name ?? 'a user';
  }

  const schedule = await tx.onCallSchedule.findUnique({ where: { id: tier.onCallScheduleId! } });
  const now = new Date();
  const shift = await tx.onCallShift.findFirst({
    where: { scheduleId: tier.onCallScheduleId!, startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { startsAt: 'asc' },
  });
  if (!shift) return `no one currently on shift for "${schedule?.name ?? 'the on-call schedule'}"`;

  const user = await tx.user.findUnique({ where: { id: shift.userId } });
  return `${user?.name ?? 'someone'} (on-call: ${schedule?.name ?? 'schedule'})`;
}

/**
 * Called from checkBreach.ts right after an SLA breach webhook fires. A no-op if
 * the tenant never configured an escalation chain (opt-in, like everything else
 * in this codebase) or if this ticket already has an active run -- a ticket
 * breaching both FIRST_RESPONSE and RESOLUTION shouldn't start two escalations.
 * See docs/adr/0020-oncall-escalation.md.
 */
export async function startEscalationIfConfigured(tenantId: string, ticketId: string): Promise<void> {
  const started = await withTenantTx(prisma, tenantId, async (tx) => {
    const tiers = await tx.escalationTier.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
    if (tiers.length === 0) return null;

    const existing = await tx.escalationRun.findFirst({ where: { ticketId, status: 'ACTIVE' } });
    if (existing) return null;

    const run = await tx.escalationRun.create({ data: { tenantId, ticketId, currentTierIndex: 0 } });
    const tier0 = tiers[0];
    const who = await describeTier(tx, tier0);
    await tx.message.create({
      data: {
        tenantId,
        ticketId,
        authorType: 'SYSTEM',
        isPrivateNote: true,
        body: `SLA breached -- escalated to tier 1: ${who}.`,
      },
    });
    return { runId: run.id, delayMinutes: tier0.escalateAfterMinutes };
  });

  if (!started) return;
  await escalationAdvanceQueue.add(
    'advance',
    { tenantId, escalationRunId: started.runId, expectedTierIndex: 0 },
    { delay: started.delayMinutes * 60_000 },
  );
}

/**
 * Fires once, at the delay captured when it was scheduled (by this function or by
 * startEscalationIfConfigured above) -- re-reads the run fresh, the same "trust
 * nothing captured at schedule time" posture apps/worker/src/sla/checkBreach.ts
 * already uses. A run that's been acknowledged, or that already advanced past
 * expectedTierIndex some other way, makes this a silent no-op.
 */
export async function advanceEscalation(payload: EscalationAdvanceJobPayload): Promise<void> {
  const { tenantId, escalationRunId, expectedTierIndex } = payload;

  const advanced = await withTenantTx(prisma, tenantId, async (tx) => {
    const run = await tx.escalationRun.findUnique({ where: { id: escalationRunId } });
    if (!run || run.status !== 'ACTIVE' || run.currentTierIndex !== expectedTierIndex) return null;

    const tiers = await tx.escalationTier.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
    const nextIndex = expectedTierIndex + 1;

    if (nextIndex >= tiers.length) {
      await tx.escalationRun.update({ where: { id: run.id }, data: { status: 'EXHAUSTED' } });
      await tx.message.create({
        data: {
          tenantId,
          ticketId: run.ticketId,
          authorType: 'SYSTEM',
          isPrivateNote: true,
          body: 'Escalation exhausted -- no one acknowledged.',
        },
      });
      return null;
    }

    const nextTier = tiers[nextIndex];
    const who = await describeTier(tx, nextTier);
    await tx.escalationRun.update({ where: { id: run.id }, data: { currentTierIndex: nextIndex } });
    await tx.message.create({
      data: {
        tenantId,
        ticketId: run.ticketId,
        authorType: 'SYSTEM',
        isPrivateNote: true,
        body: `Not acknowledged -- escalated to tier ${nextIndex + 1}: ${who}.`,
      },
    });
    return { nextIndex, delayMinutes: nextTier.escalateAfterMinutes };
  });

  if (!advanced) return;
  await escalationAdvanceQueue.add(
    'advance',
    { tenantId, escalationRunId, expectedTierIndex: advanced.nextIndex },
    { delay: advanced.delayMinutes * 60_000 },
  );
}
