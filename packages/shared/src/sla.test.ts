import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, type BusinessHoursSchedule } from './sla';

// Calendar facts used below (verified independently via plain `Date`, not this
// module): 2024-01-01 is a Monday, 2024-01-05 a Friday, 2024-01-06/07 a
// Saturday/Sunday, 2024-01-08 the following Monday.

describe('addBusinessMinutes', () => {
  it('returns the same instant when no minutes are needed', () => {
    const from = new Date('2024-01-01T11:30:00Z');
    expect(addBusinessMinutes(from, 0, { mon: [{ start: '09:00', end: '18:00' }] }, 'UTC').getTime()).toBe(from.getTime());
  });

  it('starts counting from the window open when `from` is before it opens', () => {
    const schedule: BusinessHoursSchedule = { mon: [{ start: '09:00', end: '18:00' }] };
    const from = new Date('2024-01-01T05:00:00Z'); // Monday, before the 09:00 open
    const result = addBusinessMinutes(from, 15, schedule, 'UTC');
    expect(result.toISOString()).toBe('2024-01-01T09:15:00.000Z');
  });

  it('skips a same-day gap between two windows (e.g. a lunch break)', () => {
    const schedule: BusinessHoursSchedule = {
      mon: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' },
      ],
    };
    // 11:30 Monday, needs 90 minutes: 30 min left before the break (-> 60 left),
    // then 60 more minutes into the afternoon window starting at 13:00 -> 14:00.
    const from = new Date('2024-01-01T11:30:00Z');
    const result = addBusinessMinutes(from, 90, schedule, 'UTC');
    expect(result.toISOString()).toBe('2024-01-01T14:00:00.000Z');
  });

  it('rolls over a weekend with no configured window to the next business day', () => {
    const schedule: BusinessHoursSchedule = {
      mon: [{ start: '09:00', end: '17:00' }],
      tue: [{ start: '09:00', end: '17:00' }],
      wed: [{ start: '09:00', end: '17:00' }],
      thu: [{ start: '09:00', end: '17:00' }],
      fri: [{ start: '09:00', end: '17:00' }],
    };
    // Friday 16:30, needs 60 minutes: 30 min left before Friday's 17:00 close,
    // then Saturday/Sunday have no window at all, so the remaining 30 land at
    // the following Monday's 09:00 open -> 09:30.
    const from = new Date('2024-01-05T16:30:00Z');
    const result = addBusinessMinutes(from, 60, schedule, 'UTC');
    expect(result.toISOString()).toBe('2024-01-08T09:30:00.000Z');
  });

  it('accounts for a non-UTC (fixed-offset) timezone when deciding the local weekday', () => {
    // Etc/GMT+5 is a fixed UTC-5 offset with no DST, chosen so the test doesn't
    // depend on any real region's DST calendar. 2024-01-08T02:00:00Z is
    // 2024-01-07T21:00:00 local (a Sunday evening) -- with no Sunday window,
    // the 30 needed minutes should land at Monday 09:30 local, i.e. 14:30 UTC.
    const schedule: BusinessHoursSchedule = { mon: [{ start: '09:00', end: '17:00' }] };
    const from = new Date('2024-01-08T02:00:00Z');
    const result = addBusinessMinutes(from, 30, schedule, 'Etc/GMT+5');
    expect(result.toISOString()).toBe('2024-01-08T14:30:00.000Z');
  });

  it('stays within a single window when there is enough room left in the day', () => {
    const schedule: BusinessHoursSchedule = { mon: [{ start: '09:00', end: '18:00' }] };
    const from = new Date('2024-01-01T10:00:00Z');
    const result = addBusinessMinutes(from, 60, schedule, 'UTC');
    expect(result.toISOString()).toBe('2024-01-01T11:00:00.000Z');
  });
});
