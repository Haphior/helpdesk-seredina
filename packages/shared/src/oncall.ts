// The escalation chain's own follow-up check, scheduled as a delayed BullMQ job
// by apps/worker itself after notifying each tier -- "consumes the same
// breach-check delayed-job mechanism already built rather than a second
// scheduler" (docs/ROADMAP.md). Shared only for the type; apps/worker is both
// producer and consumer of this queue (see docs/adr/0020-oncall-escalation.md
// for why the worker schedules its own follow-up jobs rather than apps/api).

export const ESCALATION_ADVANCE_QUEUE_NAME = 'escalation-advance';

export interface EscalationAdvanceJobPayload {
  tenantId: string;
  escalationRunId: string;
  /**
   * The tier index this run was at when this job was scheduled. Re-checked
   * against the run's live currentTierIndex when the job fires -- a stale job
   * (the run already advanced, or got acknowledged) is a safe no-op, exactly
   * like apps/worker/src/sla/checkBreach.ts re-checks live ticket state.
   */
  expectedTierIndex: number;
}
