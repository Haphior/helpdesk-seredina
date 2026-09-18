import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { ProcessTemplate, ProcessTemplateKind, Team } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';

interface StepDraft {
  label: string;
  teamId: string;
  requiresApproval: boolean;
}

export function ProcessTemplates() {
  const [templates, setTemplates] = useState<ProcessTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ProcessTemplate | null>(null);

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
        <Button onClick={() => setShowCreate(true)}>New template</Button>
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
            <Card key={t.id}>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14.5px] font-semibold text-slate-800">{t.name}</span>
                    {t.kind === 'CHANGE' && <Badge tone="orange">Change</Badge>}
                    {t.kind === 'RELEASE' && <Badge tone="indigo">Release</Badge>}
                  </div>
                  {t.description && <div className="text-[12.5px] text-slate-400">{t.description}</div>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <button onClick={() => setEditing(t)} className="text-xs text-slate-400 hover:text-indigo-600">
                    edit
                  </button>
                  <button onClick={() => remove(t)} className="text-xs text-slate-400 hover:text-rose-600">
                    delete
                  </button>
                </div>
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
            </Card>
          ))}
        </div>
      )}

      {showCreate && <TemplateModal onClose={() => setShowCreate(false)} onSaved={load} />}
      {editing && <TemplateModal template={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template?: ProcessTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [kind, setKind] = useState<ProcessTemplateKind>(template?.kind ?? 'GENERAL');
  const [steps, setSteps] = useState<StepDraft[]>(
    template
      ? template.steps.map((s) => ({ label: s.label, teamId: s.team?.id ?? '', requiresApproval: s.requiresApproval }))
      : [{ label: '', teamId: '', requiresApproval: false }],
  );
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
      const stepData = steps
        .filter((s) => s.label.trim())
        .map((s) => ({ label: s.label, teamId: s.teamId || undefined, requiresApproval: s.requiresApproval }));
      if (template) {
        await apiPatch(`/process-templates/${template.id}`, {
          name,
          description: description || undefined,
          steps: stepData,
        });
      } else {
        await apiPost('/process-templates', { name, description: description || undefined, kind, steps: stepData });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save template');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={template ? `Edit "${template.name}"` : 'New process template'} onClose={onClose}>
      <form onSubmit={onSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Employee Onboarding" required />

        <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />

        {template ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
            Kind (<span className="font-medium text-slate-700">{kind}</span>) can't change after creation — a template's
            kind determines which fields starting an instance requires. Create a new template if you need a different one.
          </p>
        ) : (
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
            <label className="flex flex-1 items-start gap-2 text-xs">
              <input type="radio" className="mt-0.5" checked={kind === 'RELEASE'} onChange={() => setKind('RELEASE')} />
              <span>
                <span className="block font-medium text-slate-700">Release (ITIL)</span>
                <span className="block text-slate-400">Starting an instance will require a version and can link back to the Change that approved it.</span>
              </span>
            </label>
          </div>
        )}

        <div className="border-t border-slate-200 pt-2">
          <span className="mb-2 block text-xs font-medium uppercase text-slate-400">Steps, in order</span>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border border-slate-200 p-2">
                <span className="mt-2 text-xs text-slate-400">{i + 1}.</span>
                <div className="flex-1 space-y-1.5">
                  <Input
                    hideLabel
                    aria-label={`Label for step ${i + 1}`}
                    value={step.label}
                    onChange={(e) => updateStep(i, { label: e.target.value })}
                    placeholder="Step label"
                  />
                  <div className="flex items-center gap-3">
                    <div className="w-32">
                      <Select
                        hideLabel
                        aria-label={`Team for step ${i + 1}`}
                        value={step.teamId}
                        onChange={(e) => updateStep(i, { teamId: e.target.value })}
                      >
                        <option value="">No team</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={step.requiresApproval}
                        onChange={(e) => updateStep(i, { requiresApproval: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
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
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
