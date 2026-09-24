import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { EscalationTier, OnCallSchedule, UserSummary } from '../lib/types';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { ChevronDownIcon, ChevronUpIcon } from '../components/icons';
import { formatDateTime } from '../lib/format';

export function OnCall() {
  const { t } = useTranslation();
  const [schedules, setSchedules] = useState<OnCallSchedule[] | null>(null);
  const [tiers, setTiers] = useState<EscalationTier[] | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [shiftForm, setShiftForm] = useState<Record<string, { userId: string; startsAt: string; endsAt: string }>>({});
  const [tierType, setTierType] = useState<'user' | 'schedule'>('user');
  const [tierTargetId, setTierTargetId] = useState('');
  const [tierMinutes, setTierMinutes] = useState('30');
  const [renamingSchedule, setRenamingSchedule] = useState<OnCallSchedule | null>(null);
  const [tierMinutesEdit, setTierMinutesEdit] = useState<Record<string, string>>({});

  function load() {
    Promise.all([
      apiGet<{ schedules: OnCallSchedule[] }>('/on-call-schedules'),
      apiGet<{ tiers: EscalationTier[] }>('/escalation-tiers'),
      apiGet<{ users: UserSummary[] }>('/users'),
    ])
      .then(([s, tr, u]) => {
        setSchedules(s.schedules);
        setTiers(tr.tiers);
        setUsers(u.users);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('onCall.loadFailed')));
  }

  useEffect(load, []);

  async function removeSchedule(id: string) {
    if (!confirm(t('onCall.confirmDeleteSchedule'))) return;
    try {
      await apiDelete(`/on-call-schedules/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('onCall.deleteScheduleFailed'));
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
      setError(err instanceof ApiError ? err.message : t('onCall.addShiftFailed'));
    }
  }

  async function removeShift(id: string) {
    try {
      await apiDelete(`/on-call-shifts/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('onCall.removeShiftFailed'));
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
      setError(err instanceof ApiError ? err.message : t('onCall.addTierFailed'));
    }
  }

  async function removeTier(id: string) {
    try {
      await apiDelete(`/escalation-tiers/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('onCall.removeTierFailed'));
    }
  }

  async function saveTierMinutes(tier: EscalationTier) {
    const value = Number(tierMinutesEdit[tier.id]);
    if (!value || value <= 0) return;
    try {
      await apiPatch(`/escalation-tiers/${tier.id}`, { escalateAfterMinutes: value });
      setTierMinutesEdit((v) => {
        const next = { ...v };
        delete next[tier.id];
        return next;
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('onCall.updateTierFailed'));
    }
  }

  async function moveTier(tier: EscalationTier, direction: -1 | 1) {
    if (!tiers) return;
    const i = tiers.findIndex((tr) => tr.id === tier.id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= tiers.length) return;
    const other = tiers[j];
    try {
      await Promise.all([
        apiPatch(`/escalation-tiers/${tier.id}`, { sortOrder: other.sortOrder }),
        apiPatch(`/escalation-tiers/${other.id}`, { sortOrder: tier.sortOrder }),
      ]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('onCall.reorderFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('onCall.title')}</h1>
      <p className="mb-6 text-[13.5px] text-slate-500">
        {t('onCall.intro')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      <div className="mb-8">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-slate-800">{t('onCall.schedules')}</h2>
          <Button size="sm" onClick={() => setShowCreateSchedule(true)}>
            {t('onCall.newSchedule')}
          </Button>
        </div>

        {schedules?.length === 0 && <p className="text-sm text-slate-500">{t('onCall.noSchedules')}</p>}

        <div className="flex flex-col gap-3">
          {schedules?.map((s) => (
            <Card key={s.id}>
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[14.5px] font-semibold text-slate-800">{s.name}</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => setRenamingSchedule(s)} className="text-xs text-slate-400 hover:text-indigo-600">
                    {t('onCall.rename')}
                  </button>
                  <button onClick={() => removeSchedule(s.id)} className="text-xs text-slate-400 hover:text-rose-600">
                    {t('onCall.delete')}
                  </button>
                </div>
              </div>

              <div className="mb-2 flex flex-col gap-1.5">
                {s.shifts.length === 0 && <span className="text-[12.5px] text-slate-400">{t('onCall.noShifts')}</span>}
                {s.shifts.map((shift) => (
                  <div key={shift.id} className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-[12.5px]">
                    <span className="text-slate-700">
                      {shift.user.name} · {formatDateTime(shift.startsAt)} → {formatDateTime(shift.endsAt)}
                    </span>
                    <button onClick={() => removeShift(shift.id)} className="text-slate-400 hover:text-rose-600">
                      {t('onCall.remove')}
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="w-28">
                  <Select
                    hideLabel
                    aria-label={t('onCall.whoAria', { schedule: s.name })}
                    value={shiftForm[s.id]?.userId ?? ''}
                    onChange={(e) => setShiftForm((f) => ({ ...f, [s.id]: { ...f[s.id], userId: e.target.value, startsAt: f[s.id]?.startsAt ?? '', endsAt: f[s.id]?.endsAt ?? '' } }))}
                  >
                    <option value="">{t('onCall.who')}</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Input
                  hideLabel
                  aria-label={t('onCall.startAria', { schedule: s.name })}
                  type="datetime-local"
                  value={shiftForm[s.id]?.startsAt ?? ''}
                  onChange={(e) => setShiftForm((f) => ({ ...f, [s.id]: { userId: f[s.id]?.userId ?? '', endsAt: f[s.id]?.endsAt ?? '', startsAt: e.target.value } }))}
                  className="w-auto"
                />
                <Input
                  hideLabel
                  aria-label={t('onCall.endAria', { schedule: s.name })}
                  type="datetime-local"
                  value={shiftForm[s.id]?.endsAt ?? ''}
                  onChange={(e) => setShiftForm((f) => ({ ...f, [s.id]: { userId: f[s.id]?.userId ?? '', startsAt: f[s.id]?.startsAt ?? '', endsAt: e.target.value } }))}
                  className="w-auto"
                />
                <Button size="sm" onClick={() => addShift(s.id)}>
                  {t('onCall.addShift')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2.5 text-[15px] font-bold text-slate-800">{t('onCall.chain')}</h2>
        <p className="mb-3 text-[13px] text-slate-500">
          {t('onCall.chainIntro')}
        </p>

        <div className="mb-3 flex flex-col gap-2">
          {tiers?.length === 0 && <p className="text-sm text-slate-500">{t('onCall.noChain')}</p>}
          {tiers?.map((tier, i) => (
            <div key={tier.id} className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3.5 py-2.5">
              <div className="flex items-center gap-1.5">
                <div className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    iconOnly
                    variant="ghost"
                    size="sm"
                    aria-label={t('onCall.moveUp', { n: i + 1 })}
                    onClick={() => moveTier(tier, -1)}
                    disabled={i === 0}
                    className="!h-5 !w-5"
                  >
                    <ChevronUpIcon width={12} height={12} />
                  </Button>
                  <Button
                    iconOnly
                    variant="ghost"
                    size="sm"
                    aria-label={t('onCall.moveDown', { n: i + 1 })}
                    onClick={() => moveTier(tier, 1)}
                    disabled={i === (tiers?.length ?? 0) - 1}
                    className="!h-5 !w-5"
                  >
                    <ChevronDownIcon width={12} height={12} />
                  </Button>
                </div>
                <span className="text-[13.5px] text-slate-700">
                  <span className="font-semibold">{t('onCall.tier', { n: i + 1 })}</span>{' '}
                  {tier.user ? tier.user.name : t('onCall.whoeverOnCall', { schedule: tier.onCallSchedule?.name })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] text-slate-400">{t('onCall.escalatesAfter')}</span>
                <div className="w-16">
                  <Input
                    hideLabel
                    aria-label={t('onCall.minutesAria', { n: i + 1 })}
                    type="number"
                    min={1}
                    value={tierMinutesEdit[tier.id] ?? String(tier.escalateAfterMinutes)}
                    onChange={(e) => setTierMinutesEdit((v) => ({ ...v, [tier.id]: e.target.value }))}
                  />
                </div>
                <span className="text-[12.5px] text-slate-400">{t('onCall.min')}</span>
                {tierMinutesEdit[tier.id] !== undefined && tierMinutesEdit[tier.id] !== String(tier.escalateAfterMinutes) && (
                  <Button size="sm" onClick={() => saveTierMinutes(tier)}>
                    {t('common.save')}
                  </Button>
                )}
                <button onClick={() => removeTier(tier.id)} className="text-xs text-slate-400 hover:text-rose-600">
                  {t('onCall.remove')}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="w-40">
            <Select
              hideLabel
              aria-label={t('onCall.targetType')}
              value={tierType}
              onChange={(e) => {
                setTierType(e.target.value as 'user' | 'schedule');
                setTierTargetId('');
              }}
            >
              <option value="user">{t('onCall.targetUser')}</option>
              <option value="schedule">{t('onCall.targetSchedule')}</option>
            </Select>
          </div>
          <div className="w-36">
            <Select hideLabel aria-label={t('onCall.target')} value={tierTargetId} onChange={(e) => setTierTargetId(e.target.value)}>
              <option value="">{t('onCall.choose')}</option>
              {(tierType === 'user' ? users : schedules ?? []).map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            {t('onCall.escalateAfter')}
            <div className="w-16">
              <Input hideLabel aria-label={t('onCall.escalateAfterAria')} type="number" min={1} value={tierMinutes} onChange={(e) => setTierMinutes(e.target.value)} />
            </div>
            {t('onCall.minutes')}
          </label>
          <Button size="sm" onClick={addTier} disabled={!tierTargetId}>
            {t('onCall.addTier')}
          </Button>
        </div>
      </div>

      {showCreateSchedule && <CreateScheduleModal onClose={() => setShowCreateSchedule(false)} onCreated={load} />}
      {renamingSchedule && (
        <RenameScheduleModal schedule={renamingSchedule} onClose={() => setRenamingSchedule(null)} onSaved={load} />
      )}
    </div>
  );
}

function RenameScheduleModal({
  schedule,
  onClose,
  onSaved,
}: {
  schedule: OnCallSchedule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(schedule.name);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPatch(`/on-call-schedules/${schedule.id}`, { name });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('onCall.renameFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('onCall.renameTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label={t('onCall.name')} value={name} onChange={(e) => setName(e.target.value)} required />

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CreateScheduleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('onCall.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('onCall.newTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label={t('onCall.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('onCall.namePlaceholder')} required />

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
