import { useSyncExternalStore } from 'react';
import type { Ticket } from './types';

/**
 * SLA countdown (docs/adr/0056-sla-countdown.md). The due-at instants come
 * from the API's SLA engine, which already accounts for business hours, so
 * the wall-clock time left until them is the real time left.
 */

/** Share of the SLA window used before a milestone turns amber. */
export const SLA_WARN_FRACTION = 0.75;

export type SlaMilestone = 'firstResponse' | 'resolution';
export type SlaLevel = 'ok' | 'warn' | 'breached';

export interface SlaState {
  milestone: SlaMilestone;
  dueAt: Date;
  /** Negative once breached. */
  remainingMs: number;
  /** 0..1+ share of the window since the clock started. */
  usedFraction: number;
  level: SlaLevel;
}

type SlaTicket = Pick<
  Ticket,
  'createdAt' | 'firstResponseDueAt' | 'firstRespondedAt' | 'resolutionDueAt' | 'resolvedAt' | 'closedAt'
> & { slaStartedAt?: string | null };

function stateFor(ticket: SlaTicket, milestone: SlaMilestone, dueAtIso: string, now: number): SlaState {
  const dueAt = new Date(dueAtIso);
  // The clock restarts on a priority change; tickets from before slaStartedAt
  // existed fall back to creation.
  const start = new Date(ticket.slaStartedAt ?? ticket.createdAt).getTime();
  const window = Math.max(dueAt.getTime() - start, 1);
  const remainingMs = dueAt.getTime() - now;
  const usedFraction = (now - start) / window;
  const level: SlaLevel = remainingMs < 0 ? 'breached' : usedFraction >= SLA_WARN_FRACTION ? 'warn' : 'ok';
  return { milestone, dueAt, remainingMs, usedFraction, level };
}

/** A milestone still pending (not yet met), or null if met / not tracked. */
export function milestoneState(ticket: SlaTicket, milestone: SlaMilestone, now: number): SlaState | null {
  if (milestone === 'firstResponse') {
    if (!ticket.firstResponseDueAt || ticket.firstRespondedAt) return null;
    return stateFor(ticket, milestone, ticket.firstResponseDueAt, now);
  }
  if (!ticket.resolutionDueAt || ticket.resolvedAt || ticket.closedAt) return null;
  return stateFor(ticket, milestone, ticket.resolutionDueAt, now);
}

/** The milestone that matters right now: the first pending one to come due. */
export function nextSla(ticket: SlaTicket, now: number): SlaState | null {
  const pending = [milestoneState(ticket, 'firstResponse', now), milestoneState(ticket, 'resolution', now)].filter(
    (s): s is SlaState => s !== null,
  );
  pending.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return pending[0] ?? null;
}

/** "2d 4h", "3h 20m", "9m 05s", "42s" -- seconds only in the last 10 minutes, where they matter. */
export function formatDuration(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m === 0) return `${s}s`;
  if (total < 600) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${m}m`;
}

// One shared clock for the whole page, however many countdowns are on it --
// not a setInterval per row.
const TICK_MS = 1000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The current time, re-rendering every second while mounted. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
