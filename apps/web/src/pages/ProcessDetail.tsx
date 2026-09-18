import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, apiPatch, ApiError } from '../lib/api';
import type { ProcessInstance, ProcessStepStatus, UserSummary } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { BackArrowIcon, LockIcon } from '../components/icons';
import { formatDateTime, RISK_TONE } from '../lib/format';

const INSTANCE_STATUS_TONE = { IN_PROGRESS: 'sky', COMPLETED: 'emerald', CANCELLED: 'slate' } as const;
const STEP_STATUS_TONE = { PENDING: 'slate', DONE: 'emerald', APPROVED: 'emerald', REJECTED: 'rose', SKIPPED: 'slate' } as const;

export function ProcessDetail() {
  const { id } = useParams<{ id: string }>();
  const [instance, setInstance] = useState<ProcessInstance | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof ApiError ? err.message : 'Failed to load process');
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
      setError(err instanceof ApiError ? err.message : 'Failed to update step');
    }
  }

  if (error && !instance) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!instance) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="px-9 py-7">
      <Link to="/processes" className="mb-3.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-600">
        <BackArrowIcon width={15} height={15} />
        Processes
      </Link>

      <div className="mb-5">
        <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{instance.subject}</h1>
        <div className="flex items-center gap-2">
          <Badge tone={INSTANCE_STATUS_TONE[instance.status]} dot>
            {instance.status.replace('_', ' ')}
          </Badge>
          {instance.riskLevel && (
            <Badge tone={RISK_TONE[instance.riskLevel]} dot>
              {instance.riskLevel} risk
            </Badge>
          )}
          {instance.releaseVersion && <Badge tone="indigo">{instance.releaseVersion}</Badge>}
          <span className="text-[13px] text-slate-400">from {instance.templateName}</span>
        </div>
      </div>

      {instance.riskLevel && (
        <div className="mb-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-orange-800">Change Enablement</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-slate-700">
            {instance.plannedStart && (
              <span>
                <span className="text-slate-500">Planned start:</span> {formatDateTime(instance.plannedStart)}
              </span>
            )}
            {instance.plannedEnd && (
              <span>
                <span className="text-slate-500">Planned end:</span> {formatDateTime(instance.plannedEnd)}
              </span>
            )}
          </div>
          {instance.rollbackPlan && (
            <div className="mt-2 text-[13px] text-slate-700">
              <span className="text-slate-500">Rollback plan:</span> {instance.rollbackPlan}
            </div>
          )}
        </div>
      )}

      {instance.releaseVersion && (
        <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-indigo-800">Release Management</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-slate-700">
            <span>
              <span className="text-slate-500">Version:</span> {instance.releaseVersion}
            </span>
            {instance.changeInstance && (
              <span>
                <span className="text-slate-500">Approved by:</span>{' '}
                <Link to={`/processes/${instance.changeInstance.id}`} className="font-medium text-indigo-700 hover:underline">
                  {instance.changeInstance.subject}
                </Link>
              </span>
            )}
            {instance.plannedStart && (
              <span>
                <span className="text-slate-500">Planned start:</span> {formatDateTime(instance.plannedStart)}
              </span>
            )}
            {instance.plannedEnd && (
              <span>
                <span className="text-slate-500">Planned end:</span> {formatDateTime(instance.plannedEnd)}
              </span>
            )}
          </div>
          {instance.rollbackPlan && (
            <div className="mt-2 text-[13px] text-slate-700">
              <span className="text-slate-500">Rollback plan:</span> {instance.rollbackPlan}
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
                      Approval
                    </span>
                  )}
                </div>
                <Badge tone={STEP_STATUS_TONE[step.status]} dot>
                  {step.status}
                </Badge>
              </div>

              <div className="mt-3 flex items-center gap-4">
                <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
                  <span>Status</span>
                  <div className="w-32">
                    <Select hideLabel aria-label={`Status for step ${step.label}`} value={step.status} onChange={(e) => patchStep(step.id, { status: e.target.value })}>
                      {statusOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
                  <span>Assignee</span>
                  <div className="w-36">
                    <Select
                      hideLabel
                      aria-label={`Assignee for step ${step.label}`}
                      value={step.assigneeId ?? ''}
                      onChange={(e) => patchStep(step.id, { assigneeId: e.target.value || null })}
                    >
                      <option value="">Unassigned</option>
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
            </Card>
          );
        })}
      </div>
    </div>
  );
}
