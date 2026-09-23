import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { AiAgentRun, AiAgentRunStatus, AiToolDefinitionSummary, AutonomyPolicy } from '../lib/types';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { formatDateTime } from '../lib/format';

const STATUS_TONE: Record<AiAgentRunStatus, BadgeTone> = {
  PENDING_APPROVAL: 'amber',
  EXECUTED: 'emerald',
  REJECTED: 'slate',
  FAILED: 'rose',
};

export function AiAgentActivity() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<AiToolDefinitionSummary[] | null>(null);
  const [policy, setPolicy] = useState<AutonomyPolicy | null>(null);
  const [runs, setRuns] = useState<AiAgentRun[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<AiAgentRunStatus | ''>('PENDING_APPROVAL');
  const [error, setError] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  function loadRuns(status = statusFilter) {
    const params = status ? `?status=${status}` : '';
    apiGet<{ runs: AiAgentRun[] }>(`/ai-agent-runs${params}`)
      .then((res) => setRuns(res.runs))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('aiActivity.loadFailed')));
  }

  useEffect(() => {
    apiGet<{ tools: AiToolDefinitionSummary[] }>('/ai-tools/catalog').then((res) => setTools(res.tools));
    apiGet<AutonomyPolicy>('/autonomy-policy').then(setPolicy);
    loadRuns('PENDING_APPROVAL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (policy !== null) loadRuns(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function toggleTool(name: string) {
    if (!policy) return;
    const autoExecuteTools = policy.autoExecuteTools.includes(name)
      ? policy.autoExecuteTools.filter((n) => n !== name)
      : [...policy.autoExecuteTools, name];
    setSavingPolicy(true);
    setError(null);
    try {
      const updated = await apiPatch<AutonomyPolicy>('/autonomy-policy', { autoExecuteTools });
      setPolicy(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('aiActivity.policyFailed'));
    } finally {
      setSavingPolicy(false);
    }
  }

  async function updateMaxActions(value: number) {
    if (!policy) return;
    setSavingPolicy(true);
    try {
      const updated = await apiPatch<AutonomyPolicy>('/autonomy-policy', { maxActionsPerDay: value });
      setPolicy(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('aiActivity.policyFailed'));
    } finally {
      setSavingPolicy(false);
    }
  }

  async function act(id: string, action: 'approve' | 'reject') {
    setActingOnId(id);
    setError(null);
    try {
      await apiPost(`/ai-agent-runs/${id}/${action}`);
      loadRuns();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(`aiActivity.${action}Failed`));
    } finally {
      setActingOnId(null);
    }
  }

  const mutatingTools = tools?.filter((tool) => tool.mutating) ?? [];

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('aiActivity.title')}</h1>
      <p className="mb-6 max-w-2xl text-[13.5px] text-slate-500">
        {t('aiActivity.intro')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      <Card className="mb-8 !p-5">
        <h2 className="mb-1 text-[15px] font-bold text-slate-800">{t('aiActivity.policyTitle')}</h2>
        <p className="mb-4 text-[12.5px] text-slate-500">
          {t('aiActivity.policyIntro')}
        </p>

        {!policy || !tools ? (
          <p className="text-sm text-slate-500">{t('common.loading')}</p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {mutatingTools.map((tool) => (
                <label
                  key={tool.name}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-[13px] hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={policy.autoExecuteTools.includes(tool.name)}
                    onChange={() => toggleTool(tool.name)}
                    disabled={savingPolicy}
                    className="mt-0.5 h-3.5 w-3.5 accent-indigo-600"
                  />
                  <span>
                    <span className="block font-mono text-[12.5px] font-semibold text-slate-800">{tool.name}</span>
                    <span className="block text-[12px] text-slate-500">{t(`aiActivity.tools.${tool.name}`, { defaultValue: tool.description })}</span>
                  </span>
                </label>
              ))}
            </div>

            <label className="flex max-w-xs items-center justify-between gap-3 text-[13px] text-slate-600">
              <span>{t('aiActivity.maxPerDay')}</span>
              <div className="w-20">
                <Input
                  hideLabel
                  aria-label={t('aiActivity.maxPerDay')}
                  type="number"
                  min={0}
                  max={1000}
                  value={policy.maxActionsPerDay}
                  onChange={(e) => updateMaxActions(Number(e.target.value))}
                  disabled={savingPolicy}
                />
              </div>
            </label>
          </>
        )}
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-slate-800">{t('aiActivity.log')}</h2>
        <div className="w-40">
          <Select
            hideLabel
            aria-label={t('aiActivity.filter')}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AiAgentRunStatus | '')}
          >
            <option value="PENDING_APPROVAL">{t('aiActivity.status.PENDING_APPROVAL')}</option>
            <option value="EXECUTED">{t('aiActivity.status.EXECUTED')}</option>
            <option value="REJECTED">{t('aiActivity.status.REJECTED')}</option>
            <option value="FAILED">{t('aiActivity.status.FAILED')}</option>
            <option value="">{t('aiActivity.all')}</option>
          </Select>
        </div>
      </div>

      {runs === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {runs?.length === 0 && <p className="text-sm text-slate-500">{t('aiActivity.empty')}</p>}

      {runs && runs.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {runs.map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold text-slate-800">{run.toolName}</span>
                    <Badge tone={STATUS_TONE[run.status]}>{t(`aiActivity.status.${run.status}`)}</Badge>
                    <span className="text-[11.5px] uppercase tracking-wide text-slate-400">{t('aiActivity.via', { source: run.source })}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    {run.ticket ? (
                      <Link to={`/tickets/${run.ticket.id}`} className="text-indigo-700 hover:underline">
                        #{run.ticket.number} {run.ticket.subject}
                      </Link>
                    ) : (
                      <span>{t('aiActivity.noTicket')}</span>
                    )}
                    {' · '}
                    {formatDateTime(run.createdAt)}
                    {run.reviewedByUser && <span> · {t('aiActivity.reviewedBy', { name: run.reviewedByUser.name })}</span>}
                  </div>
                  {run.errorMessage && <div className="mt-0.5 text-[12px] text-rose-600">{run.errorMessage}</div>}
                </div>
                {run.status === 'PENDING_APPROVAL' && (
                  <div className="flex flex-shrink-0 gap-2">
                    <Button size="sm" variant="secondary" onClick={() => act(run.id, 'reject')} isLoading={actingOnId === run.id}>
                      {t('aiActivity.reject')}
                    </Button>
                    <Button size="sm" onClick={() => act(run.id, 'approve')} isLoading={actingOnId === run.id}>
                      {t('aiActivity.approve')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
