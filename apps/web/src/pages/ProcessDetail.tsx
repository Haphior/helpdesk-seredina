import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { ProcessInstance, ProcessStepStatus, Ticket, TicketPriority, UserSummary } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Textarea } from '../components/Textarea';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { BackArrowIcon, LockIcon, TicketIcon } from '../components/icons';
import { formatDateTime, RISK_TONE } from '../lib/format';

const INSTANCE_STATUS_TONE = { IN_PROGRESS: 'sky', COMPLETED: 'emerald', CANCELLED: 'slate' } as const;
const STEP_STATUS_TONE = { PENDING: 'slate', DONE: 'emerald', APPROVED: 'emerald', REJECTED: 'rose', SKIPPED: 'slate' } as const;

export function ProcessDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [instance, setInstance] = useState<ProcessInstance | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingTicketFor, setCreatingTicketFor] = useState<string | null>(null);
  const [linkingTicketFor, setLinkingTicketFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [inst, u] = await Promise.all([
        apiGet<ProcessInstance>(`/process-instances/${id}`),
        apiGet<{ users: UserSummary[] }>('/users'),
      ]);
      setInstance(inst);
      setUsers(u.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('processDetail.loadFailed'));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function patchStep(stepId: string, data: Record<string, unknown>) {
    try {
      await apiPatch(`/process-steps/${stepId}`, data);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('processDetail.updateFailed'));
    }
  }

  if (error && !instance) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!instance) return <div className="p-6 text-sm text-slate-500">{t('common.loading')}</div>;

  return (
    <div className="px-9 py-7">
      <Link to="/processes" className="mb-3.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-600">
        <BackArrowIcon width={15} height={15} />
        {t('processes.title')}
      </Link>

      <div className="mb-5">
        <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{instance.subject}</h1>
        <div className="flex items-center gap-2">
          <Badge tone={INSTANCE_STATUS_TONE[instance.status]} dot>
            {t(`processStatus.${instance.status}`)}
          </Badge>
          {instance.riskLevel && (
            <Badge tone={RISK_TONE[instance.riskLevel]} dot>
              {t('processes.riskBadge', { level: t(`risk.${instance.riskLevel}`) })}
            </Badge>
          )}
          {instance.releaseVersion && <Badge tone="indigo">{instance.releaseVersion}</Badge>}
          <span className="text-[13px] text-slate-400">{t('processDetail.from', { name: instance.templateName })}</span>
        </div>
      </div>

      {instance.riskLevel && (
        <div className="mb-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-orange-800">{t('processDetail.change')}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-slate-700">
            {instance.plannedStart && (
              <span>
                <span className="text-slate-500">{t('processDetail.plannedStart')}</span> {formatDateTime(instance.plannedStart)}
              </span>
            )}
            {instance.plannedEnd && (
              <span>
                <span className="text-slate-500">{t('processDetail.plannedEnd')}</span> {formatDateTime(instance.plannedEnd)}
              </span>
            )}
          </div>
          {instance.rollbackPlan && (
            <div className="mt-2 text-[13px] text-slate-700">
              <span className="text-slate-500">{t('processDetail.rollback')}</span> {instance.rollbackPlan}
            </div>
          )}
        </div>
      )}

      {instance.releaseVersion && (
        <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-indigo-800">{t('processDetail.release')}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-slate-700">
            <span>
              <span className="text-slate-500">{t('processDetail.version')}</span> {instance.releaseVersion}
            </span>
            {instance.changeInstance && (
              <span>
                <span className="text-slate-500">{t('processDetail.approvedBy')}</span>{' '}
                <Link to={`/processes/${instance.changeInstance.id}`} className="font-medium text-indigo-700 hover:underline">
                  {instance.changeInstance.subject}
                </Link>
              </span>
            )}
            {instance.plannedStart && (
              <span>
                <span className="text-slate-500">{t('processDetail.plannedStart')}</span> {formatDateTime(instance.plannedStart)}
              </span>
            )}
            {instance.plannedEnd && (
              <span>
                <span className="text-slate-500">{t('processDetail.plannedEnd')}</span> {formatDateTime(instance.plannedEnd)}
              </span>
            )}
          </div>
          {instance.rollbackPlan && (
            <div className="mt-2 text-[13px] text-slate-700">
              <span className="text-slate-500">{t('processDetail.rollback')}</span> {instance.rollbackPlan}
            </div>
          )}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

      <div className="flex flex-col gap-2.5">
        {instance.steps.map((step, i) => {
          const statusOptions: ProcessStepStatus[] = step.requiresApproval
            ? ['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED']
            : ['PENDING', 'DONE', 'SKIPPED'];
          return (
            <Card key={step.id}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-medium text-slate-400">{i + 1}.</span>
                  <span className="text-[14px] font-semibold text-slate-800">{step.label}</span>
                  {step.requiresApproval && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                      <LockIcon width={10} height={10} />
                      {t('processDetail.approval')}
                    </span>
                  )}
                </div>
                <Badge tone={STEP_STATUS_TONE[step.status]} dot>
                  {t(`stepStatus.${step.status}`)}
                </Badge>
              </div>

              <div className="mt-3 flex items-center gap-4">
                <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
                  <span>{t('processDetail.status')}</span>
                  <div className="w-32">
                    <Select hideLabel aria-label={t('processDetail.statusAria', { step: step.label })} value={step.status} onChange={(e) => patchStep(step.id, { status: e.target.value })}>
                      {statusOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {t(`stepStatus.${opt}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
                  <span>{t('processDetail.assignee')}</span>
                  <div className="w-36">
                    <Select
                      hideLabel
                      aria-label={t('processDetail.assigneeAria', { step: step.label })}
                      value={step.assigneeId ?? ''}
                      onChange={(e) => patchStep(step.id, { assigneeId: e.target.value || null })}
                    >
                      <option value="">{t('common.unassigned')}</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                {step.assignee && <Avatar name={step.assignee.name} size={20} />}
                {step.completedAt && <span className="text-[11.5px] text-slate-400">{formatDateTime(step.completedAt)}</span>}
              </div>

              <div className="mt-2.5 border-t border-slate-100 pt-2.5">
                {step.ticket ? (
                  <Link
                    to={`/tickets/${step.ticket.id}`}
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-indigo-600 hover:underline"
                  >
                    <TicketIcon width={13} height={13} />#{step.ticket.number} {step.ticket.subject}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 text-[12.5px]">
                    <button onClick={() => setCreatingTicketFor(step.id)} className="font-medium text-indigo-600 hover:underline">
                      {t('processDetail.createTicket')}
                    </button>
                    <button onClick={() => setLinkingTicketFor(step.id)} className="font-medium text-slate-400 hover:text-slate-600">
                      {t('processDetail.linkTicket')}
                    </button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {creatingTicketFor && (
        <CreateTicketForStepModal
          stepId={creatingTicketFor}
          defaultAssigneeId={instance.steps.find((s) => s.id === creatingTicketFor)?.assigneeId ?? ''}
          users={users}
          onClose={() => setCreatingTicketFor(null)}
          onCreated={load}
        />
      )}

      {linkingTicketFor && (
        <LinkTicketModal stepId={linkingTicketFor} onClose={() => setLinkingTicketFor(null)} onLinked={load} />
      )}
    </div>
  );
}

function CreateTicketForStepModal({
  stepId,
  defaultAssigneeId,
  users,
  onClose,
  onCreated,
}: {
  stepId: string;
  defaultAssigneeId: string;
  users: UserSummary[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost(`/process-steps/${stepId}/create-ticket`, {
        subject,
        body,
        contactName,
        contactEmail,
        priority,
        assigneeId: assigneeId || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('processDetail.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('processDetail.createTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label={t('processDetail.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} required />
        <Textarea label={t('processDetail.description')} value={body} onChange={(e) => setBody(e.target.value)} rows={4} required />
        <div className="flex gap-2">
          <div className="flex-1">
            <Input label={t('processDetail.requesterName')} value={contactName} onChange={(e) => setContactName(e.target.value)} required />
          </div>
          <div className="flex-1">
            <Input label={t('processDetail.requesterEmail')} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Select label={t('processDetail.priority')} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              <option value="LOW">{t('priority.LOW')}</option>
              <option value="NORMAL">{t('priority.NORMAL')}</option>
              <option value="HIGH">{t('priority.HIGH')}</option>
              <option value="URGENT">{t('priority.URGENT')}</option>
            </Select>
          </div>
          <div className="flex-1">
            <Select label={t('processDetail.assignee')} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">{t('common.unassigned')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? t('common.creating') : t('processDetail.createTicketButton')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LinkTicketModal({ stepId, onClose, onLinked }: { stepId: string; onClose: () => void; onLinked: () => void }) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<Ticket[]>([]);
  const [ticketId, setTicketId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<{ tickets: Ticket[] }>('/tickets')
      .then((res) => setCandidates(res.tickets.filter((tk) => !tk.mergedIntoId)))
      .catch(() => {});
  }, []);

  async function onSubmit() {
    if (!ticketId) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiPatch(`/process-steps/${stepId}`, { ticketId });
      onLinked();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('processDetail.linkFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('processDetail.linkTitle')} onClose={onClose}>
      <div className="space-y-3">
        <Select label={t('processDetail.ticket')} value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
          <option value="">{t('processDetail.chooseTicket')}</option>
          {candidates.map((tk) => (
            <option key={tk.id} value={tk.id}>
              #{tk.number} {tk.subject}
            </option>
          ))}
        </Select>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={!ticketId} isLoading={submitting}>
            {submitting ? t('processDetail.linking') : t('processDetail.linkTicketButton')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
