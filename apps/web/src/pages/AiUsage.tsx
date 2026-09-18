import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, ApiError } from '../lib/api';
import type { AiUsageSummary } from '../lib/types';
import { formatDateTime } from '../lib/format';
import { Card } from '../components/Card';

const ACTION_LABEL: Record<string, string> = {
  suggest_reply: 'Suggest reply',
  summarize: 'Summarize',
};

export function AiUsage() {
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AiUsageSummary>('/ai-usage/summary')
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load AI usage'));
  }, []);

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">AI Usage</h1>
      <p className="mb-6 text-[13.5px] text-slate-500">
        What every AI copilot call has actually cost, in real dollars — because the bring-your-own-key adapter means
        Seredina never marks this up.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {summary === null && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {summary && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card>
              <div className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">Total cost</div>
              <div className="mt-1 text-[20px] font-extrabold tabular-nums text-slate-900">${summary.totalCostUsd.toFixed(4)}</div>
            </Card>
            <Card>
              <div className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">Total AI calls</div>
              <div className="mt-1 text-[20px] font-extrabold tabular-nums text-slate-900">{summary.totalCalls}</div>
            </Card>
            {summary.byAction.map((b) => (
              <Card key={b.action}>
                <div className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
                  {ACTION_LABEL[b.action] ?? b.action}
                </div>
                <div className="mt-1 text-[20px] font-extrabold tabular-nums text-slate-900">${b.costUsd.toFixed(4)}</div>
                <div className="text-[11.5px] text-slate-400">{b.calls} calls</div>
              </Card>
            ))}
          </div>

          <h2 className="mb-2.5 text-[15px] font-bold text-slate-800">Recent activity</h2>
          {summary.recent.length === 0 ? (
            <p className="text-sm text-slate-500">No AI activity yet.</p>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="grid grid-cols-[130px_1fr_120px_90px_90px_90px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <span>When</span>
                <span>Ticket</span>
                <span>Action</span>
                <span>Model</span>
                <span>Tokens</span>
                <span className="text-right">Cost</span>
              </div>
              <div className="divide-y divide-slate-100">
                {summary.recent.map((log) => (
                  <div
                    key={log.id}
                    className="grid grid-cols-[130px_1fr_120px_90px_90px_90px] items-center gap-3 px-5 py-2.5 text-[12.5px]"
                  >
                    <span className="text-slate-400">{formatDateTime(log.createdAt)}</span>
                    {log.ticket ? (
                      <Link to={`/tickets/${log.ticket.id}`} className="truncate font-medium text-indigo-700 hover:underline">
                        #{log.ticket.number} {log.ticket.subject}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                    <span className="text-slate-600">{ACTION_LABEL[log.action] ?? log.action}</span>
                    <span className="truncate text-slate-400">{log.model}</span>
                    <span className="tabular-nums text-slate-400">
                      {log.inputTokens}+{log.outputTokens}
                    </span>
                    <span className="text-right font-medium tabular-nums text-slate-700">
                      {log.estimatedCostUsd !== null ? `$${Number(log.estimatedCostUsd).toFixed(4)}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
