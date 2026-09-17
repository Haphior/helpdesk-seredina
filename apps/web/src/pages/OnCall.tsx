import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { EscalationTier, OnCallSchedule, UserSummary } from '../lib/types';
import { Modal } from '../components/Modal';
import { formatDateTime } from '../lib/format';

export function OnCall() {
  const [schedules, setSchedules] = useState<OnCallSchedule[] | null>(null);
  const [tiers, setTiers] = useState<EscalationTier[] | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [shiftForm, setShiftForm] = useState<Record<string, { userId: string; startsAt: string; endsAt: string }>>({});
  const [tierType, setTierType] = useState<'user' | 'schedule'>('user');
  const [tierTargetId, setTierTargetId] = useState('');
  const [tierMinutes, setTierMinutes] = useState('30');

  function load() {
    Promise.all([
      apiGet<{ schedules: OnCallSchedule[] }>('/on-call-schedules'),
      apiGet<{ tiers: EscalationTier[] }>('/escalation-tiers'),
      apiGet<{ users: UserSummary[] }>('/users'),
    ])
      .then(([s, t, u]) => {
        setSchedules(s.schedules);
        setTiers(t.tiers);
        setUsers(u.users);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load on-call configuration'));
  }

  useEffect(load, []);

  async function removeSchedule(id: string) {
    if (!confirm('Delete this schedule and its shifts? Any escalation tier pointing at it will also be removed.')) return;
    try {
      await apiDelete(`/on-call-schedules/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete schedule');
    }
  }

  async function addShift(scheduleId: string) {
    const form = shiftForm[scheduleId];
    if (!form?.userId || !form.startsAt || !form.endsAt) return;
    try {
      await apiPost(`/on-call-schedules/${scheduleId}/shifts`, form);
      setShiftForm((f) => ({ ...f, [scheduleId]: { userId: '', startsAt: '', endsAt: '' } }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add shift');
    }
  }

  async function removeShift(id: string) {
    try {
      await apiDelete(`/on-call-shifts/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove shift');
    }
  }

  async function addTier() {
    if (!tierTargetId || !tierMinutes) return;
    try {
      await apiPost('/escalation-tiers', {
        userId: tierType === 'user' ? tierTargetId : undefined,
        onCallScheduleId: tierType === 'schedule' ? tierTargetId : undefined,
        escalateAfterMinutes: Number(tierMinutes),
      });
      setTierTargetId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add escalation tier');
    }
  }

  async function removeTier(id: string) {
    try {
      await apiDelete(`/escalation-tiers/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove tier');
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">On-Call &amp; Escalation</h1>
      <p className="mb-6 text-[13.5px] text-slate-500">
        Who's on call, and who gets notified next if an SLA breach goes unacknowledged.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      <div className="mb-8">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-slate-800">On-call schedules</h2>
          <button
            onClick={() => setShowCreateSchedule(true)}
            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            New schedule
          </button>
        </div>

        {schedules?.length === 0 && <p className="text-sm text-slate-500">No on-call schedules yet.</p>}

        <div className="flex flex-col gap-3">
          {schedules?.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[14.5px] font-semibold text-slate-800">{s.name}</span>
                <button onClick={() => removeSchedule(s.id)} className="text-xs text-slate-400 hover:text-rose-600">
                  delete
                </button>
              </div>

              <div className="mb-2 flex flex-col gap-1.5">
                {s.shifts.length === 0 && <span className="text-[12.5px] text-slate-400">No shifts scheduled yet.</span>}
                {s.shifts.map((shift) => (
                  <div key={shift.id} className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-[12.5px]">
                    <span className="text-slate-700">
                      {shift.user.name} · {formatDateTime(shift.startsAt)} → {formatDateTime(shift.endsAt)}
                    </span>
                    <button onClick={() => removeShift(shift.id)} className="text-slate-400 hover:text-rose-600">
                      remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <select
                  value={shiftForm[s.id]?.userId ?? ''}
                  onChange={(e) => setShiftForm((f) => ({ ...f, [s.id]: { ...f[s.id], userId: e.target.value, startsAt: f[s.id]?.startsAt ?? '', endsAt: f[s.id]?.endsAt ?? '' } }))}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="">Who…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={shiftForm[s.id]?.startsAt ?? ''}
                  onChange={(e) => setShiftForm((f) => ({ ...f, [s.id]: { userId: f[s.id]?.userId ?? '', endsAt: f[s.id]?.endsAt ?? '', startsAt: e.target.value } }))}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <input
                  type="datetime-local"
                  value={shiftForm[s.id]?.endsAt ?? ''}
                  onChange={(e) => setShiftForm((f) => ({ ...f, [s.id]: { userId: f[s.id]?.userId ?? '', startsAt: f[s.id]?.startsAt ?? '', endsAt: e.target.value } }))}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <button
                  onClick={() => addShift(s.id)}
                  className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Add shift
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2.5 text-[15px] font-bold text-slate-800">Escalation chain</h2>
        <p className="mb-3 text-[13px] text-slate-500">
          When an SLA milestone is breached, tier 1 is notified. If nobody acknowledges within its window, the chain moves to
          the next tier.
        </p>

        <div className="mb-3 flex flex-col gap-2">
          {tiers?.length === 0 && <p className="text-sm text-slate-500">No escalation chain configured yet — SLA breaches won't escalate.</p>}
          {tiers?.map((t, i) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3.5 py-2.5">
              <span className="text-[13.5px] text-slate-700">
                <span className="font-semibold">Tier {i + 1}:</span> {t.user ? t.user.name : `whoever's on call for "${t.onCallSchedule?.name}"`}{' '}
                <span className="text-slate-400">· escalates after {t.escalateAfterMinutes} min</span>
              </span>
              <button onClick={() => removeTier(t.id)} className="text-xs text-slate-400 hover:text-rose-600">
                remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <select
            value={tierType}
            onChange={(e) => {
              setTierType(e.target.value as 'user' | 'schedule');
              setTierTargetId('');
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="user">A specific person</option>
            <option value="schedule">Whoever's on call for…</option>
          </select>
          <select
            value={tierTargetId}
            onChange={(e) => setTierTargetId(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">Choose…</option>
            {(tierType === 'user' ? users : schedules ?? []).map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Escalate after
            <input
              type="number"
              min={1}
              value={tierMinutes}
              onChange={(e) => setTierMinutes(e.target.value)}
              className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
            minutes
          </label>
          <button
            onClick={addTier}
            disabled={!tierTargetId}
            className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Add tier
          </button>
        </div>
      </div>

      {showCreateSchedule && <CreateScheduleModal onClose={() => setShowCreateSchedule(false)} onCreated={load} />}
    </div>
  );
}

function CreateScheduleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/on-call-schedules', { name });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create schedule');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New on-call schedule" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Primary IT On-Call"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
