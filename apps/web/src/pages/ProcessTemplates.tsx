import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { ProcessTemplate, ProcessTemplateKind, Team } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';

interface StepDraft {
  label: string;
  teamId: string;
  requiresApproval: boolean;
}

export function ProcessTemplates() {
  const [templates, setTemplates] = useState<ProcessTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    apiGet<{ templates: ProcessTemplate[] }>('/process-templates')
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load process templates'));
  }

  useEffect(load, []);

  async function remove(template: ProcessTemplate) {
    if (!confirm(`Delete template "${template.name}"? Processes already started from it keep running unaffected.`)) return;
    try {
      await apiDelete(`/process-templates/${template.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete template');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Process Templates</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New template
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Multi-step checklists for things that outlive a single ticket — onboarding, a contract approval chain. Start one from
        the Processes page.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {templates === null && <p className="text-sm text-slate-500">Loading…</p>}
      {templates?.length === 0 && <p className="text-sm text-slate-500">No process templates yet.</p>}

      {templates && templates.length > 0 && (
        <div className="flex flex-col gap-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14.5px] font-semibold text-slate-800">{t.name}</span>
                    {t.kind === 'CHANGE' && <Badge tone="orange">Change</Badge>}
                  </div>
                  {t.description && <div className="text-[12.5px] text-slate-400">{t.description}</div>}
                </div>
                <button onClick={() => remove(t)} className="text-xs text-slate-400 hover:text-rose-600">
                  delete
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {t.steps.map((s, i) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] text-slate-600"
                  >
                    {i + 1}. {s.label}
                    {s.requiresApproval && <Badge tone="rose">approval</Badge>}
                    {s.team && <span className="text-slate-400">· {s.team.name}</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateTemplateModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}

function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ProcessTemplateKind>('GENERAL');
  const [steps, setSteps] = useState<StepDraft[]>([{ label: '', teamId: '', requiresApproval: false }]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<{ teams: Team[] }>('/teams')
      .then((res) => setTeams(res.teams))
      .catch(() => {});
  }, []);

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((s) => s.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function addStep() {
    setSteps((s) => [...s, { label: '', teamId: '', requiresApproval: false }]);
  }

  function removeStep(index: number) {
    setSteps((s) => s.filter((_, i) => i !== index));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/process-templates', {
        name,
        description: description || undefined,
        kind,
        steps: steps
          .filter((s) => s.label.trim())
          .map((s) => ({ label: s.label, teamId: s.teamId || undefined, requiresApproval: s.requiresApproval })),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create template');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New process template" onClose={onClose}>
      <form onSubmit={onSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Employee Onboarding"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Description (optional)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <div className="flex gap-2 rounded-md border border-slate-200 p-2">
          <label className="flex flex-1 items-start gap-2 text-xs">
            <input type="radio" className="mt-0.5" checked={kind === 'GENERAL'} onChange={() => setKind('GENERAL')} />
            <span>
              <span className="block font-medium text-slate-700">General process</span>
              <span className="block text-slate-400">Onboarding, a contract chain — any multi-step checklist.</span>
            </span>
          </label>
          <label className="flex flex-1 items-start gap-2 text-xs">
            <input type="radio" className="mt-0.5" checked={kind === 'CHANGE'} onChange={() => setKind('CHANGE')} />
            <span>
              <span className="block font-medium text-slate-700">Change (ITIL)</span>
              <span className="block text-slate-400">Starting an instance will require a risk level and offer a planned window/rollback plan.</span>
            </span>
          </label>
        </div>

        <div className="border-t border-slate-200 pt-2">
          <span className="mb-2 block text-xs font-medium uppercase text-slate-400">Steps, in order</span>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border border-slate-200 p-2">
                <span className="mt-2 text-xs text-slate-400">{i + 1}.</span>
                <div className="flex-1 space-y-1.5">
                  <input
                    value={step.label}
                    onChange={(e) => updateStep(i, { label: e.target.value })}
                    placeholder="Step label"
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <div className="flex items-center gap-3">
                    <select
                      value={step.teamId}
                      onChange={(e) => updateStep(i, { teamId: e.target.value })}
                      className="rounded-md border border-slate-300 px-1.5 py-1 text-xs"
                    >
                      <option value="">No team</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={step.requiresApproval}
                        onChange={(e) => updateStep(i, { requiresApproval: e.target.checked })}
                      />
                      Requires approval
                    </label>
                  </div>
                </div>
                {steps.length > 1 && (
                  <button type="button" onClick={() => removeStep(i)} className="mt-1 text-xs text-slate-400 hover:text-rose-600">
                    remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addStep} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
            + Add step
          </button>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
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
