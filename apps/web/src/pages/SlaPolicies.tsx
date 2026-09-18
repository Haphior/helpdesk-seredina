import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPut, ApiError } from '../lib/api';
import type { SlaPolicy, TicketPriority } from '../lib/types';
import { PRIORITY_TONE } from '../lib/format';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

interface RowState {
  firstResponseMinutes: string;
  resolutionMinutes: string;
  businessHoursOnly: boolean;
}

const EMPTY_ROW: RowState = { firstResponseMinutes: '', resolutionMinutes: '', businessHoursOnly: false };

export function SlaPolicies() {
  const [policies, setPolicies] = useState<SlaPolicy[] | null>(null);
  const [rows, setRows] = useState<Record<TicketPriority, RowState>>({
    LOW: EMPTY_ROW,
    NORMAL: EMPTY_ROW,
    HIGH: EMPTY_ROW,
    URGENT: EMPTY_ROW,
  });
  const [error, setError] = useState<string | null>(null);
  const [savingPriority, setSavingPriority] = useState<TicketPriority | null>(null);

  function load() {
    apiGet<{ slaPolicies: SlaPolicy[] }>('/sla-policies')
      .then((res) => {
        setPolicies(res.slaPolicies);
        const next = { LOW: EMPTY_ROW, NORMAL: EMPTY_ROW, HIGH: EMPTY_ROW, URGENT: EMPTY_ROW } as Record<TicketPriority, RowState>;
        for (const p of res.slaPolicies) {
          next[p.priority] = {
            firstResponseMinutes: String(p.firstResponseMinutes),
            resolutionMinutes: String(p.resolutionMinutes),
            businessHoursOnly: p.businessHoursOnly,
          };
        }
        setRows(next);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load SLA policies'));
  }

  useEffect(load, []);

  function updateRow(priority: TicketPriority, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [priority]: { ...prev[priority], ...patch } }));
  }

  async function save(priority: TicketPriority) {
    const row = rows[priority];
    setError(null);
    setSavingPriority(priority);
    try {
      await apiPut('/sla-policies', {
        priority,
        firstResponseMinutes: Number(row.firstResponseMinutes),
        resolutionMinutes: Number(row.resolutionMinutes),
        businessHoursOnly: row.businessHoursOnly,
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save SLA policy');
    } finally {
      setSavingPriority(null);
    }
  }

  async function remove(priority: TicketPriority) {
    const existing = policies?.find((p) => p.priority === priority);
    if (!existing) return;
    if (!confirm(`Remove the SLA policy for ${priority} priority? Tickets at this priority will no longer get due dates.`)) return;
    try {
      await apiDelete(`/sla-policies/${existing.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove SLA policy');
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">SLA Policies</h1>
      <p className="mb-5 text-[13.5px] text-slate-500">
        First response and resolution targets, per priority. A priority with no policy here gets no due dates at all —
        SLA tracking is opt-in. Business-hours-only targets use the schedule set on the Business Hours page.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {policies === null && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {policies !== null && (
        <div className="flex flex-col gap-2.5">
          {PRIORITIES.map((priority) => {
            const row = rows[priority];
            const configured = policies.some((p) => p.priority === priority);
            return (
              <Card key={priority} className="flex items-center gap-4">
                <span className="w-24 flex-shrink-0">
                  <Badge tone={PRIORITY_TONE[priority]} dot>
                    {priority}
                  </Badge>
                </span>

                <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
                  First response
                  <div className="w-24">
                    <Input
                      hideLabel
                      aria-label={`First response minutes for ${priority} priority`}
                      type="number"
                      min={1}
                      value={row.firstResponseMinutes}
                      onChange={(e) => updateRow(priority, { firstResponseMinutes: e.target.value })}
                      placeholder="e.g. 30"
                    />
                  </div>
                  min
                </label>

                <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
                  Resolution
                  <div className="w-24">
                    <Input
                      hideLabel
                      aria-label={`Resolution minutes for ${priority} priority`}
                      type="number"
                      min={1}
                      value={row.resolutionMinutes}
                      onChange={(e) => updateRow(priority, { resolutionMinutes: e.target.value })}
                      placeholder="e.g. 30"
                    />
                  </div>
                  min
                </label>

                <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={row.businessHoursOnly}
                    onChange={(e) => updateRow(priority, { businessHoursOnly: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
                  />
                  Business hours only
                </label>

                <div className="ml-auto flex items-center gap-3">
                  {configured && (
                    <button onClick={() => remove(priority)} className="text-xs text-slate-400 hover:text-rose-600">
                      remove
                    </button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => save(priority)}
                    isLoading={savingPriority === priority}
                    disabled={!row.firstResponseMinutes || !row.resolutionMinutes}
                  >
                    {savingPriority === priority ? 'Saving…' : configured ? 'Update' : 'Save'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
