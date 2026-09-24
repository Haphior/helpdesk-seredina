import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, ApiError } from '../lib/api';
import type { AuditLogEntry } from '../lib/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { formatDateTime } from '../lib/format';

// Prefix filters -- the API treats a value ending in '.' as "starts with".
const CATEGORIES = ['', 'auth.', 'user.', 'role.', 'email_channel.', 'api_key.', 'webhook.', 'device.', 'ai_settings.', 'tenant.'] as const;

function describeMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';
  return Object.entries(metadata)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ');
}

export function AuditLog() {
  const { t } = useTranslation();
  const [category, setCategory] = useState<string>('');
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    (cursor: string | null) => {
      const qs = new URLSearchParams({ limit: '50' });
      if (category) qs.set('action', category);
      if (cursor) qs.set('cursor', cursor);
      return apiGet<{ entries: AuditLogEntry[]; nextCursor: string | null }>(`/audit-logs?${qs.toString()}`);
    },
    [category],
  );

  useEffect(() => {
    setEntries(null);
    fetchPage(null)
      .then((res) => {
        setEntries(res.entries);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('auditLog.loadFailed')));
  }, [fetchPage, t]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage(nextCursor);
      setEntries((prev) => [...(prev ?? []), ...res.entries]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auditLog.loadFailed'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('auditLog.title')}</h1>
      <p className="mb-5 text-[13.5px] text-slate-500">{t('auditLog.intro')}</p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c || 'all'}
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${
              category === c ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t(`auditLog.category.${c ? c.slice(0, -1) : 'all'}`)}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {entries === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {entries?.length === 0 && <p className="text-sm text-slate-500">{t('auditLog.empty')}</p>}

      {entries && entries.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">{t('auditLog.when')}</th>
                <th className="px-5 py-2.5">{t('auditLog.who')}</th>
                <th className="px-5 py-2.5">{t('auditLog.what')}</th>
                <th className="px-5 py-2.5">{t('auditLog.target')}</th>
                <th className="px-5 py-2.5">{t('auditLog.from')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{formatDateTime(e.createdAt)}</td>
                  <td className="px-5 py-3 text-slate-700">
                    {e.actorLabel ?? t(`auditLog.actor.${e.actorType}`, { defaultValue: e.actorType })}
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-semibold text-slate-800">{t(`auditLog.action.${e.action}`, { defaultValue: e.action })}</span>
                    {e.metadata && Object.keys(e.metadata).length > 0 && (
                      <p className="mt-0.5 max-w-md text-xs text-slate-500">{describeMetadata(e.metadata)}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{e.targetLabel ?? (e.targetType ? t(`auditLog.targetType.${e.targetType}`, { defaultValue: e.targetType }) : '')}</td>
                  <td className="px-5 py-3 text-xs text-slate-400">
                    {e.ipAddress}
                    {e.userAgent && <p className="max-w-[16rem] truncate" title={e.userAgent}>{e.userAgent}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" onClick={loadMore} isLoading={loadingMore}>
            {t('auditLog.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
