import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from '../lib/api';
import type { ProcessInstance, ProcessTemplate } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';

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
                  <div className="text-[14px] font-semibold text-slate-800">{inst.subject}</div>
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

function StartProcessModal({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const [templates, setTemplates] = useState<ProcessTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<{ templates: ProcessTemplate[] }>('/process-templates')
      .then((res) => {
        setTemplates(res.templates);
        setTemplateId(res.templates[0]?.id ?? '');
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/process-instances', { templateId, subject });
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
