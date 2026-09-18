import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from '../lib/api';
import type { ChangeRiskLevel, ProcessInstance, ProcessInstanceStatus, ProcessTemplate } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';
import { Card } from '../components/Card';
import { RISK_TONE } from '../lib/format';

const STATUS_TONE = { IN_PROGRESS: 'sky', COMPLETED: 'emerald', CANCELLED: 'slate' } as const;

const TABS: { key: ProcessInstanceStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

const PAGE_SIZE = 50;

function progress(instance: ProcessInstance) {
  const done = instance.steps.filter((s) => s.status !== 'PENDING').length;
  return `${done}/${instance.steps.length}`;
}

export function Processes() {
  const [tab, setTab] = useState<ProcessInstanceStatus | 'ALL'>('ALL');
  const [instances, setInstances] = useState<ProcessInstance[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(false);

  function load(offset = 0) {
    if (offset > 0) setLoadingMore(true);
    const params = new URLSearchParams();
    if (tab !== 'ALL') params.set('status', tab);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    apiGet<{ instances: ProcessInstance[]; total: number }>(`/process-instances?${params.toString()}`)
      .then((res) => {
        setInstances((prev) => (offset > 0 && prev ? [...prev, ...res.instances] : res.instances));
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load processes'))
      .finally(() => setLoadingMore(false));
  }

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Processes</h1>
        <Button onClick={() => setShowStart(true)}>Start process</Button>
      </div>
      <p className="mb-4 text-[13.5px] text-slate-500">
        Onboarding, contract approvals — anything that's a checklist over days, not a single ticket conversation.
      </p>

      <div className="mb-5 flex gap-1 rounded-[9px] bg-slate-100 p-[3px]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {instances === null && <p className="text-sm text-slate-500">Loading…</p>}
      {instances?.length === 0 && <p className="text-sm text-slate-500">No processes here.</p>}

      {instances && instances.length > 0 && (
        <Card className="overflow-hidden p-0">
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
        </Card>
      )}

      {instances && instances.length < total && (
        <div className="flex justify-center pt-4">
          <Button variant="secondary" onClick={() => load(instances.length)} isLoading={loadingMore}>
            {loadingMore ? 'Loading…' : `Load more (${total - instances.length} remaining)`}
          </Button>
        </div>
      )}

      {showStart && <StartProcessModal onClose={() => setShowStart(false)} onStarted={() => load(0)} />}
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
        <div className="flex-1">
          <Input
            label="Planned start (optional)"
            type="datetime-local"
            value={plannedStart}
            onChange={(e) => setPlannedStart(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <Input
            label="Planned end (optional)"
            type="datetime-local"
            value={plannedEnd}
            onChange={(e) => setPlannedEnd(e.target.value)}
          />
        </div>
      </div>
      <Textarea
        label="Rollback plan (optional)"
        value={rollbackPlan}
        onChange={(e) => setRollbackPlan(e.target.value)}
        rows={2}
        placeholder="How do we undo this if it goes wrong?"
      />
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
          <Select label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.kind === 'CHANGE' ? ' (Change)' : ''}
                {t.kind === 'RELEASE' ? ' (Release)' : ''}
              </option>
            ))}
          </Select>

          <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Onboarding: Jane Doe" required />

          {isChange && (
            <div className="space-y-2.5 rounded-md border border-orange-200 bg-orange-50 p-2.5">
              <p className="text-xs font-semibold text-orange-800">Change Enablement — a risk assessment is required.</p>
              <Select label="Risk level" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as ChangeRiskLevel)}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </Select>
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
              <Input label="Version" value={releaseVersion} onChange={(e) => setReleaseVersion(e.target.value)} placeholder="v2.4.0" required />
              <Select label="Approved by which Change? (optional)" value={changeInstanceId} onChange={(e) => setChangeInstanceId(e.target.value)}>
                <option value="">No linked change</option>
                {changeInstances.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.subject}
                  </option>
                ))}
              </Select>
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
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={submitting}>
              {submitting ? 'Starting…' : 'Start'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
