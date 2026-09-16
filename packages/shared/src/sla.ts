// SLA breach checks are scheduled as delayed BullMQ jobs (one per milestone, fired
// at the due-at timestamp) rather than a polling scan across every open ticket --
// see docs/adr/0011-sla-engine.md. Shared between apps/api (schedules) and
// apps/worker (checks + dispatches the webhook event), same reasoning as webhooks.ts.

export const SLA_BREACH_QUEUE_NAME = 'sla-breach-check';

export type SlaMilestone = 'FIRST_RESPONSE' | 'RESOLUTION';

export interface SlaBreachCheckJobPayload {
  tenantId: string;
  ticketId: string;
  milestone: SlaMilestone;
}

export interface DayWindow {
  /** 24h "HH:mm", e.g. "09:00" */
  start: string;
  /** 24h "HH:mm", e.g. "18:00" */
  end: string;
}

export interface BusinessHoursSchedule {
  sun?: DayWindow[];
  mon?: DayWindow[];
  tue?: DayWindow[];
  wed?: DayWindow[];
  thu?: DayWindow[];
  fri?: DayWindow[];
  sat?: DayWindow[];
}

const DAY_KEYS: (keyof BusinessHoursSchedule)[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The UTC offset for `timeZone` at `instant`, in minutes (e.g. -180 for UTC-3).
 * Computed via Intl (no date/timezone library dependency) by formatting `instant`
 * in `timeZone`, re-interpreting those wall-clock parts as if they were UTC, and
 * diffing against the real UTC instant.
 */
function getUtcOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

/**
 * Walks forward from `fromUtc`, accumulating only minutes that fall inside
 * `schedule`'s windows (in `timeZone`), until `minutesNeeded` have elapsed, and
 * returns the resulting UTC instant.
 *
 * Known limitation: the UTC offset is computed once, at `fromUtc`, and held
 * constant for the whole walk. A calculation that happens to straddle a DST
 * transition in `timeZone` will be off by that transition's shift (usually 60
 * minutes) for any part of the walk past the transition. Acceptable for a first
 * pass -- most SLA windows are hours to a few days, DST-straddling is rare, and
 * the failure mode is a due date off by an hour, not a security or data issue. See
 * docs/adr/0011-sla-engine.md.
 */
export function addBusinessMinutes(fromUtc: Date, minutesNeeded: number, schedule: BusinessHoursSchedule, timeZone: string): Date {
  if (minutesNeeded <= 0) return new Date(fromUtc);

  const offsetMin = getUtcOffsetMinutes(fromUtc, timeZone);
  let cursorMs = fromUtc.getTime() + offsetMin * 60_000; // wall-clock-as-UTC cursor
  let remaining = minutesNeeded;

  // Guard against an all-empty schedule (every day omitted/empty) looping forever.
  for (let dayGuard = 0; dayGuard < 3650 && remaining > 0; dayGuard++) {
    const cursor = new Date(cursorMs);
    const dayKey = DAY_KEYS[cursor.getUTCDay()];
    const dayStartMs = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate());
    const windows = schedule[dayKey] ?? [];

    for (const w of windows) {
      const [wsH, wsM] = w.start.split(':').map(Number);
      const [weH, weM] = w.end.split(':').map(Number);
      const winStart = dayStartMs + wsH * 3_600_000 + wsM * 60_000;
      const winEnd = dayStartMs + weH * 3_600_000 + weM * 60_000;

      const segStart = Math.max(winStart, cursorMs);
      if (segStart >= winEnd) continue; // this window is entirely behind the cursor already

      const availableMin = (winEnd - segStart) / 60_000;
      if (availableMin >= remaining) {
        cursorMs = segStart + remaining * 60_000;
        remaining = 0;
        break;
      }
      remaining -= availableMin;
      cursorMs = winEnd;
    }

    if (remaining <= 0) break;
    cursorMs = dayStartMs + 24 * 3_600_000; // no room left today -- jump to next local midnight
  }

  return new Date(cursorMs - offsetMin * 60_000);
}
