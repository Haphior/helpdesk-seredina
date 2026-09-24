import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { ProcessTemplate, ProcessTemplateKind, Team } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { DragHandleIcon } from '../components/icons';

interface StepDraft {
  label: string;
  teamId: string;
  requiresApproval: boolean;
}

export function ProcessTemplates() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<ProcessTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ProcessTemplate | null>(null);

  function load() {
    apiGet<{ templates: ProcessTemplate[] }>('/process-templates')
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('processTemplates.loadFailed')));
  }

  useEffect(load, []);

  async function remove(template: ProcessTemplate) {
    if (!confirm(t('processTemplates.confirmDelete', { name: template.name }))) return;
    try {
      await apiDelete(`/process-templates/${template.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('processTemplates.deleteFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('processTemplates.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('processTemplates.new')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('processTemplates.intro')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {templates === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {templates?.length === 0 && <p className="text-sm text-slate-500">{t('processTemplates.empty')}</p>}

      {templates && templates.length > 0 && (
        <div className="flex flex-col gap-3">
          {templates.map((tpl) => (
            <Card key={tpl.id}>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14.5px] font-semibold text-slate-800">{tpl.name}</span>
                    {tpl.kind === 'CHANGE' && <Badge tone="orange">{t('processes.kind.CHANGE')}</Badge>}
                    {tpl.kind === 'RELEASE' && <Badge tone="indigo">{t('processes.kind.RELEASE')}</Badge>}
                  </div>
                  {tpl.description && <div className="text-[12.5px] text-slate-400">{tpl.description}</div>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <button onClick={() => setEditing(tpl)} className="text-xs text-slate-400 hover:text-indigo-600">
                    {t('processTemplates.edit')}
                  </button>
                  <button onClick={() => remove(tpl)} className="text-xs text-slate-400 hover:text-rose-600">
                    {t('processTemplates.delete')}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tpl.steps.map((s, i) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] text-slate-600"
                  >
                    {i + 1}. {s.label}
                    {s.requiresApproval && <Badge tone="rose">{t('processTemplates.approval')}</Badge>}
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
  const { t } = useTranslation();
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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

  function duplicateStep(index: number) {
    setSteps((s) => [...s.slice(0, index + 1), { ...s[index] }, ...s.slice(index + 1)]);
  }

  function removeStep(index: number) {
    setSteps((s) => s.filter((_, i) => i !== index));
  }

  // Native HTML5 drag-and-drop, same pattern as the dashboard-builder's widget
  // reorder -- this app doesn't pull in a library for something this scoped.
  function moveStep(from: number, to: number) {
    if (from === to) return;
    setSteps((s) => {
      const next = [...s];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
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
      setError(err instanceof ApiError ? err.message : t('processTemplates.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={template ? t('processTemplates.editTitle', { name: template.name }) : t('processTemplates.newTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <Input label={t('processTemplates.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('processTemplates.namePlaceholder')} required />

        <Input label={t('processTemplates.description')} value={description} onChange={(e) => setDescription(e.target.value)} />

        {template ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{t(`processTemplates.kinds.${kind}.label`)}</span> — {t('processTemplates.kindImmutable')}
          </p>
        ) : (
          <div className="flex gap-2 rounded-md border border-slate-200 p-2">
            <label className="flex flex-1 items-start gap-2 text-xs">
              <input type="radio" className="mt-0.5" checked={kind === 'GENERAL'} onChange={() => setKind('GENERAL')} />
              <span>
                <span className="block font-medium text-slate-700">{t('processTemplates.kinds.GENERAL.label')}</span>
                <span className="block text-slate-400">{t('processTemplates.kinds.GENERAL.hint')}</span>
              </span>
            </label>
            <label className="flex flex-1 items-start gap-2 text-xs">
              <input type="radio" className="mt-0.5" checked={kind === 'CHANGE'} onChange={() => setKind('CHANGE')} />
              <span>
                <span className="block font-medium text-slate-700">{t('processTemplates.kinds.CHANGE.label')}</span>
                <span className="block text-slate-400">{t('processTemplates.kinds.CHANGE.hint')}</span>
              </span>
            </label>
            <label className="flex flex-1 items-start gap-2 text-xs">
              <input type="radio" className="mt-0.5" checked={kind === 'RELEASE'} onChange={() => setKind('RELEASE')} />
              <span>
                <span className="block font-medium text-slate-700">{t('processTemplates.kinds.RELEASE.label')}</span>
                <span className="block text-slate-400">{t('processTemplates.kinds.RELEASE.hint')}</span>
              </span>
            </label>
          </div>
        )}

        <div className="border-t border-slate-200 pt-2">
          <span className="mb-2 block text-xs font-medium uppercase text-slate-400">{t('processTemplates.steps')}</span>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-md border border-slate-200 p-2 ${dragIndex === i ? 'opacity-40' : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) moveStep(dragIndex, i);
                  setDragIndex(null);
                }}
              >
                <span
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => setDragIndex(null)}
                  aria-label={t('processTemplates.drag')}
                  title={t('processTemplates.drag')}
                  className="mt-1.5 cursor-grab text-slate-300 hover:text-slate-400 active:cursor-grabbing"
                >
                  <DragHandleIcon width={13} height={13} />
                </span>
                <span className="mt-2 text-xs text-slate-400">{i + 1}.</span>
                <div className="flex-1 space-y-1.5">
                  <Input
                    hideLabel
                    aria-label={t('processTemplates.stepLabelAria', { n: i + 1 })}
                    value={step.label}
                    onChange={(e) => updateStep(i, { label: e.target.value })}
                    placeholder={t('processTemplates.stepLabel')}
                  />
                  <div className="flex items-center gap-3">
                    <div className="w-32">
                      <Select
                        hideLabel
                        aria-label={t('processTemplates.stepTeamAria', { n: i + 1 })}
                        value={step.teamId}
                        onChange={(e) => updateStep(i, { teamId: e.target.value })}
                      >
                        <option value="">{t('processTemplates.noTeam')}</option>
                        {teams.map((tm) => (
                          <option key={tm.id} value={tm.id}>
                            {tm.name}
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
                      {t('processTemplates.requiresApproval')}
                    </label>
                  </div>
                </div>
                <div className="mt-1 flex flex-col items-end gap-1">
                  <button type="button" onClick={() => duplicateStep(i)} className="text-xs text-slate-400 hover:text-indigo-600">
                    {t('processTemplates.duplicate')}
                  </button>
                  {steps.length > 1 && (
                    <button type="button" onClick={() => removeStep(i)} className="text-xs text-slate-400 hover:text-rose-600">
                      {t('processTemplates.remove')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addStep} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
            {t('processTemplates.addStep')}
          </button>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
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
