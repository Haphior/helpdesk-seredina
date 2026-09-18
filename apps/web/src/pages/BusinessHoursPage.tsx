import { useEffect, useState } from 'react';
import { apiGet, apiPut, ApiError } from '../lib/api';
import type { BusinessHoursSchedule } from '../lib/types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';

const DAYS: { key: keyof BusinessHoursSchedule; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

interface DayRow {
  enabled: boolean;
  start: string;
  end: string;
}

const DEFAULT_ROW: DayRow = { enabled: false, start: '09:00', end: '18:00' };

export function BusinessHoursPage() {
  const [timezone, setTimezone] = useState('UTC');
  const [days, setDays] = useState<Record<string, DayRow>>(() =>
    Object.fromEntries(DAYS.map((d) => [d.key, { ...DEFAULT_ROW }])),
  );
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    apiGet<{ businessHours: { timezone: string; schedule: BusinessHoursSchedule } | null }>('/business-hours')
      .then((res) => {
        if (res.businessHours) {
          setTimezone(res.businessHours.timezone);
          const next = Object.fromEntries(DAYS.map((d) => [d.key, { ...DEFAULT_ROW }])) as Record<string, DayRow>;
          for (const d of DAYS) {
            const window = res.businessHours.schedule[d.key]?.[0];
            if (window) next[d.key] = { enabled: true, start: window.start, end: window.end };
          }
          setDays(next);
        }
        setLoaded(true);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load business hours');
        setLoaded(true);
      });
  }, []);

  function updateDay(key: string, patch: Partial<DayRow>) {
    setDays((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const schedule: BusinessHoursSchedule = {};
      for (const d of DAYS) {
        const row = days[d.key];
        if (row.enabled) schedule[d.key] = [{ start: row.start, end: row.end }];
      }
      await apiPut('/business-hours', { timezone, schedule });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save business hours');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">Business Hours</h1>
      <p className="mb-5 max-w-xl text-[13.5px] text-slate-500">
        Only consulted by an SLA policy with "business hours only" checked — a due date computed from those policies
        skips the closed hours below instead of counting straight calendar time. One window per day in this first
        pass (no split lunch-break schedules yet).
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {loaded && (
        <div className="max-w-xl">
          <div className="mb-4">
            <div className="w-64">
              <Input label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. America/Santiago" />
            </div>
            <span className="ml-0.5 mt-1 block text-xs text-slate-400">IANA name (America/Santiago, UTC, Etc/GMT+5, …)</span>
          </div>

          <div className="flex flex-col gap-2">
            {DAYS.map((d) => {
              const row = days[d.key];
              return (
                <Card key={d.key} className="flex items-center gap-3">
                  <label className="flex w-32 flex-shrink-0 items-center gap-2 text-[13px] font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) => updateDay(d.key, { enabled: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
                    />
                    {d.label}
                  </label>
                  {row.enabled ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Input
                        hideLabel
                        aria-label={`${d.label} start time`}
                        type="time"
                        value={row.start}
                        onChange={(e) => updateDay(d.key, { start: e.target.value })}
                      />
                      to
                      <Input
                        hideLabel
                        aria-label={`${d.label} end time`}
                        type="time"
                        value={row.end}
                        onChange={(e) => updateDay(d.key, { end: e.target.value })}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Closed</span>
                  )}
                </Card>
              );
            })}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Button onClick={save} isLoading={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {savedAt && <span className="text-xs text-emerald-600">Saved.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
