import { prisma, withTenantTx, type Prisma, type TicketPriority } from '@seredina/db';
import { addBusinessMinutes, type BusinessHoursSchedule, type SlaMilestone } from '@seredina/shared';
import { slaBreachQueue } from '../../lib/queue';

export interface UpsertSlaPolicyInput {
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  businessHoursOnly: boolean;
}

export async function listSlaPolicies(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) => tx.slaPolicy.findMany({ orderBy: { priority: 'asc' } }));
}

export async function upsertSlaPolicy(tenantId: string, input: UpsertSlaPolicyInput) {
  if (input.firstResponseMinutes <= 0 || input.resolutionMinutes <= 0) {
    throw new Error('SLA targets must be positive numbers of minutes');
  }
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.slaPolicy.upsert({
      where: { tenantId_priority: { tenantId, priority: input.priority } },
      create: { tenantId, ...input },
      update: input,
    }),
  );
}

export async function deleteSlaPolicy(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.slaPolicy.findUnique({ where: { id } });
    if (!existing) throw new Error('SLA policy not found');
    await tx.slaPolicy.delete({ where: { id } });
  });
}

export async function getBusinessHours(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) => tx.businessHours.findUnique({ where: { tenantId } }));
}

export interface UpsertBusinessHoursInput {
  timezone: string;
  schedule: BusinessHoursSchedule;
}

export async function upsertBusinessHours(tenantId: string, input: UpsertBusinessHoursInput) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.businessHours.upsert({
      where: { tenantId },
      create: { tenantId, timezone: input.timezone, schedule: input.schedule as Prisma.InputJsonValue },
      update: { timezone: input.timezone, schedule: input.schedule as Prisma.InputJsonValue },
    }),
  );
}

export interface SlaDueAts {
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
}

/**
 * Looks up the SlaPolicy for `priority` (none = no SLA tracking, the intended
 * "opt-in" default) and computes due-ats from `from`. Pure read + arithmetic, no
 * external I/O -- safe to call inside a withTenantTx like its callers do.
 */
export async function computeSlaDueAts(tx: Prisma.TransactionClient, tenantId: string, priority: TicketPriority, from: Date): Promise<SlaDueAts> {
  const policy = await tx.slaPolicy.findUnique({ where: { tenantId_priority: { tenantId, priority } } });
  if (!policy) return { firstResponseDueAt: null, resolutionDueAt: null };

  if (!policy.businessHoursOnly) {
    return {
      firstResponseDueAt: new Date(from.getTime() + policy.firstResponseMinutes * 60_000),
      resolutionDueAt: new Date(from.getTime() + policy.resolutionMinutes * 60_000),
    };
  }

  const businessHours = await tx.businessHours.findUnique({ where: { tenantId } });
  if (!businessHours) {
    // businessHoursOnly=true but the tenant never configured a schedule -- fall
    // back to calendar time rather than throwing; a half-configured tenant still
    // gets due dates, just not business-hours-aware ones, until they finish
    // setting up Business Hours.
    return {
      firstResponseDueAt: new Date(from.getTime() + policy.firstResponseMinutes * 60_000),
      resolutionDueAt: new Date(from.getTime() + policy.resolutionMinutes * 60_000),
    };
  }

  const schedule = businessHours.schedule as BusinessHoursSchedule;
  return {
    firstResponseDueAt: addBusinessMinutes(from, policy.firstResponseMinutes, schedule, businessHours.timezone),
    resolutionDueAt: addBusinessMinutes(from, policy.resolutionMinutes, schedule, businessHours.timezone),
  };
}

/**
 * Enqueues one delayed job per non-null due-at, outside any tx (network I/O never
 * belongs inside withTenantTx) -- same "compute inside, enqueue outside" split as
 * dispatchWebhookEvent. The job re-checks live ticket state when it fires (see
 * apps/worker/src/sla/checkBreach.ts), so scheduling a job here is provisional,
 * not a commitment -- if the ticket meets the milestone or its priority changes
 * before the delay elapses, the job is a safe no-op when it runs.
 */
export async function scheduleSlaBreachChecks(tenantId: string, ticketId: string, dueAts: SlaDueAts) {
  const now = Date.now();
  const jobs: { milestone: SlaMilestone; dueAt: Date | null }[] = [
    { milestone: 'FIRST_RESPONSE', dueAt: dueAts.firstResponseDueAt },
    { milestone: 'RESOLUTION', dueAt: dueAts.resolutionDueAt },
  ];

  await Promise.all(
    jobs
      .filter((j) => j.dueAt)
      .map((j) =>
        slaBreachQueue.add(
          'check',
          { tenantId, ticketId, milestone: j.milestone },
          { delay: Math.max(0, j.dueAt!.getTime() - now) },
        ),
      ),
  );
}
