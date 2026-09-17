import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from '../lib/api';
import type { ChangeRiskLevel, ProcessInstance, ProcessTemplate } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { RISK_TONE } from '../lib/format';

const STATUS_TONE = { IN_PROGRESS: 'sky', COMPLETED: 'emerald', CANCELLED: 'slate' } as const;

function progress(instance: ProcessInstance) {
  const done = instance.steps.filter((s) => s.status !== 'PENDING').length;
  return `${done}/${instance.steps.length}`;
}

export function Processes() {
  const [instances, setInstances] = useState<ProcessInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(false);

  function load() {
    apiGet<{ instances: ProcessInstance[] }>('/process-instances')
      .then((res) => setInstances(res.instances))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load processes'));
  }

  useEffect(load, []);

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Processes</h1>
        <button
          onClick={() => setShowStart(true)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          Start process
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Onboarding, contract approvals — anything that's a checklist over days, not a single ticket conversation.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {instances === null && <p className="text-sm text-slate-500">Loading…</p>}
      {instances?.length === 0 && <p className="text-sm text-slate-500">No processes started yet.</p>}

      {instances && instances.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {instances.map((inst) => (
              <Link
                key={inst.id}
                to={`/processes/${inst.id}`}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-slate-800">{inst.subject}</span>
                    {inst.riskLevel && (
                      <Badge tone={RISK_TONE[inst.riskLevel]} dot>
                        {inst.riskLevel} risk
                      </Badge>
                    )}
                    {inst.releaseVersion && <Badge tone="indigo">{inst.releaseVersion}</Badge>}
                  </div>
                  <div className="text-[12.5px] text-slate-400">{inst.templateName}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12.5px] text-slate-400">{progress(inst)} steps</span>
                  <Badge tone={STATUS_TONE[inst.status]} dot>
                    {inst.status.replace('_', ' ')}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {showStart && <StartProcessModal onClose={() => setShowStart(false)} onStarted={load} />}
    </div>
  );
}

function PlannedWindowFields({
  plannedStart,
  setPlannedStart,
  plannedEnd,
  setPlannedEnd,
  rollbackPlan,
  setRollbackPlan,
}: {
  plannedStart: string;
  setPlannedStart: (v: string) => void;
  plannedEnd: string;
  setPlannedEnd: (v: string) => void;
  rollbackPlan: string;
  setRollbackPlan: (v: string) => void;
}) {
  return (
    <>
      <div className="flex gap-2">
        <label className="block flex-1 text-xs">
          <span className="mb-1 block font-medium text-slate-700">Planned start (optional)</span>
          <input
            type="datetime-local"
            value={plannedStart}
            onChange={(e) => setPlannedStart(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
        </label>
        <label className="block flex-1 text-xs">
          <span className="mb-1 block font-medium text-slate-700">Planned end (optional)</span>
          <input
            type="datetime-local"
            value={plannedEnd}
            onChange={(e) => setPlannedEnd(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
        </label>
      </div>
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-slate-700">Rollback plan (optional)</span>
        <textarea
          value={rollbackPlan}
          onChange={(e) => setRollbackPlan(e.target.value)}
          rows={2}
          placeholder="How do we undo this if it goes wrong?"
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </label>
    </>
  );
}

function StartProcessModal({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const [templates, setTemplates] = useState<ProcessTemplate[]>([]);
  const [changeInstances, setChangeInstances] = useState<ProcessInstance[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [riskLevel, setRiskLevel] = useState<ChangeRiskLevel>('MEDIUM');
  const [releaseVersion, setReleaseVersion] = useState('');
  const [changeInstanceId, setChangeInstanceId] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [rollbackPlan, setRollbackPlan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<{ templates: ProcessTemplate[] }>('/process-templates')
      .then((res) => {
        setTemplates(res.templates);
        setTemplateId(res.templates[0]?.id ?? '');
      })
      .catch(() => {});
    // Only needed to populate the "link to a Change" dropdown below -- any
    // instance with a riskLevel came from a CHANGE-kind template.
    apiGet<{ instances: ProcessInstance[] }>('/process-instances')
      .then((res) => setChangeInstances(res.instances.filter((i) => i.riskLevel)))
      .catch(() => {});
  }, []);

  const selectedTemplate = templates.find((t) => t.id === templateId);
  const isChange = selectedTemplate?.kind === 'CHANGE';
  const isRelease = selectedTemplate?.kind === 'RELEASE';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/process-instances', {
        templateId,
        subject,
        ...(isChange ? { riskLevel } : {}),
        ...(isRelease ? { releaseVersion, changeInstanceId: changeInstanceId || undefined } : {}),
        ...(isChange || isRelease
          ? {
              plannedStart: plannedStart || undefined,
              plannedEnd: plannedEnd || undefined,
              rollbackPlan: rollbackPlan || undefined,
            }
          : {}),
      });
      onStarted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start process');
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <Modal title="Start a process" onClose={onClose}>
      {templates.length === 0 ? (
        <p className="text-sm text-slate-500">No process templates yet — create one on the Process Templates page first.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Template</span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.kind === 'CHANGE' ? ' (Change)' : ''}
                  {t.kind === 'RELEASE' ? ' (Release)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Onboarding: Jane Doe"
              required
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>

          {isChange && (
            <div className="space-y-2.5 rounded-md border border-orange-200 bg-orange-50 p-2.5">
              <p className="text-xs font-semibold text-orange-800">Change Enablement — a risk assessment is required.</p>
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-slate-700">Risk level</span>
                <select
                  value={riskLevel}
                  onChange={(e) => setRiskLevel(e.target.value as ChangeRiskLevel)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
              </label>
              <PlannedWindowFields
                plannedStart={plannedStart}
                setPlannedStart={setPlannedStart}
                plannedEnd={plannedEnd}
                setPlannedEnd={setPlannedEnd}
                rollbackPlan={rollbackPlan}
                setRollbackPlan={setRollbackPlan}
              />
            </div>
          )}

          {isRelease && (
            <div className="space-y-2.5 rounded-md border border-indigo-200 bg-indigo-50 p-2.5">
              <p className="text-xs font-semibold text-indigo-800">Release Management — a version is required.</p>
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-slate-700">Version</span>
                <input
                  value={releaseVersion}
                  onChange={(e) => setReleaseVersion(e.target.value)}
                  placeholder="v2.4.0"
                  required
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-slate-700">Approved by which Change? (optional)</span>
                <select
                  value={changeInstanceId}
                  onChange={(e) => setChangeInstanceId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="">No linked change</option>
                  {changeInstances.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.subject}
                    </option>
                  ))}
                </select>
              </label>
              <PlannedWindowFields
                plannedStart={plannedStart}
                setPlannedStart={setPlannedStart}
                plannedEnd={plannedEnd}
                setPlannedEnd={setPlannedEnd}
                rollbackPlan={rollbackPlan}
                setRollbackPlan={setRollbackPlan}
              />
            </div>
          )}

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
              {submitting ? 'Starting…' : 'Start'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
