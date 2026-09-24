import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPatch, ApiError } from '../lib/api';
import type { Problem, ProblemStatus, ProcessInstance, Ticket, UserSummary } from '../lib/types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';
import { Card } from '../components/Card';
import { BackArrowIcon } from '../components/icons';
import { formatDateTime, PROBLEM_STATUS_TONE } from '../lib/format';

const STATUSES: ProblemStatus[] = ['UNDER_INVESTIGATION', 'KNOWN_ERROR', 'RESOLVED', 'CLOSED'];

export function ProblemDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [changeInstances, setChangeInstances] = useState<ProcessInstance[]>([]);
  const [unlinkedTickets, setUnlinkedTickets] = useState<Ticket[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [ticketToLink, setTicketToLink] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [workaround, setWorkaround] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [p, instances, tickets, u] = await Promise.all([
        apiGet<Problem>(`/problems/${id}`),
        apiGet<{ instances: ProcessInstance[] }>('/process-instances'),
        apiGet<{ tickets: Ticket[] }>('/tickets'),
        apiGet<{ users: UserSummary[] }>('/users'),
      ]);
      setProblem(p);
      setRootCause(p.rootCause ?? '');
      setWorkaround(p.workaround ?? '');
      setChangeInstances(instances.instances.filter((i) => i.riskLevel));
      setUnlinkedTickets(tickets.tickets.filter((tk) => !tk.problemId));
      setUsers(u.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('problemDetail.loadFailed'));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(data: Record<string, unknown>) {
    if (!id) return;
    try {
      await apiPatch(`/problems/${id}`, data);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('problemDetail.updateFailed'));
    }
  }

  async function linkTicket() {
    if (!id || !ticketToLink) return;
    try {
      await apiPatch(`/tickets/${ticketToLink}`, { problemId: id });
      setTicketToLink('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('problemDetail.linkFailed'));
    }
  }

  async function unlinkTicket(ticketId: string) {
    try {
      await apiPatch(`/tickets/${ticketId}`, { problemId: null });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('problemDetail.unlinkFailed'));
    }
  }

  if (error && !problem) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!problem) return <div className="p-6 text-sm text-slate-500">{t('common.loading')}</div>;

  return (
    <div className="px-9 py-7">
      <Link to="/problems" className="mb-3.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-600">
        <BackArrowIcon width={15} height={15} />
        {t('problems.title')}
      </Link>

      <div className="mb-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[15px] font-semibold text-slate-400">#{problem.number}</span>
          <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{problem.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={PROBLEM_STATUS_TONE[problem.status]} dot>
            {t(`problemStatus.${problem.status}`)}
          </Badge>
          {problem.resolvedAt && <span className="text-[13px] text-slate-400">{t('problemDetail.resolvedAt', { when: formatDateTime(problem.resolvedAt) })}</span>}
        </div>
        {problem.description && <p className="mt-2 text-[13.5px] text-slate-600">{problem.description}</p>}
      </div>

      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

      <div className="grid grid-cols-[1fr_260px] gap-5">
        <div className="flex flex-col gap-4">
          <Card>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{t('problemDetail.rootCause')}</span>
              <Textarea
                hideLabel
                aria-label={t('problemDetail.rootCause')}
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                onBlur={() => rootCause !== (problem.rootCause ?? '') && patch({ rootCause: rootCause || null })}
                rows={3}
                placeholder={t('problemDetail.rootCausePlaceholder')}
              />
            </label>
          </Card>

          <Card>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{t('problemDetail.workaround')}</span>
              <Textarea
                hideLabel
                aria-label={t('problemDetail.workaround')}
                value={workaround}
                onChange={(e) => setWorkaround(e.target.value)}
                onBlur={() => workaround !== (problem.workaround ?? '') && patch({ workaround: workaround || null })}
                rows={3}
                placeholder={t('problemDetail.workaroundPlaceholder')}
              />
            </label>
          </Card>

          <Card>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t('problemDetail.linkedTickets', { count: problem.tickets.length })}
              </span>
            </div>
            <div className="mb-3 flex items-end gap-2">
              <div className="flex-1">
                <Select hideLabel aria-label={t('problemDetail.linkExisting')} value={ticketToLink} onChange={(e) => setTicketToLink(e.target.value)}>
                  <option value="">{t('problemDetail.linkExistingPlaceholder')}</option>
                  {unlinkedTickets.map((tk) => (
                    <option key={tk.id} value={tk.id}>
                      #{tk.number} {tk.subject}
                    </option>
                  ))}
                </Select>
              </div>
              <Button size="sm" onClick={linkTicket} disabled={!ticketToLink}>
                {t('problemDetail.link')}
              </Button>
            </div>
            {problem.tickets.length === 0 ? (
              <p className="text-[13px] text-slate-400">{t('problemDetail.noTickets')}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {problem.tickets.map((tk) => (
                  <div key={tk.id} className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5">
                    <Link to={`/tickets/${tk.id}`} className="text-[13px] font-medium text-indigo-700 hover:underline">
                      #{tk.number} {tk.subject}
                    </Link>
                    <button onClick={() => unlinkTicket(tk.id)} className="text-xs text-slate-400 hover:text-rose-600">
                      {t('problemDetail.unlink')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card className="flex flex-col gap-3.5">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{t('problemDetail.status')}</span>
            <Select hideLabel aria-label={t('problemDetail.status')} value={problem.status} onChange={(e) => patch({ status: e.target.value })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`problemStatus.${s}`)}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{t('problemDetail.owner')}</span>
            <Select hideLabel aria-label={t('problemDetail.owner')} value={problem.ownerId ?? ''} onChange={(e) => patch({ ownerId: e.target.value || null })}>
              <option value="">{t('problems.unowned')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </label>

          <div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{t('problemDetail.fixedBy')}</span>
              <Select
                hideLabel
                aria-label={t('problemDetail.fixedBy')}
                value={problem.changeInstanceId ?? ''}
                onChange={(e) => patch({ changeInstanceId: e.target.value || null })}
              >
                <option value="">{t('problemDetail.noChange')}</option>
                {changeInstances.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.subject}
                  </option>
                ))}
              </Select>
            </label>
            {problem.changeInstance && (
              <Link
                to={`/processes/${problem.changeInstance.id}`}
                className="mt-1.5 block text-[12.5px] font-medium text-indigo-700 hover:underline"
              >
                {t('problemDetail.viewChange', { subject: problem.changeInstance.subject })} →
              </Link>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
