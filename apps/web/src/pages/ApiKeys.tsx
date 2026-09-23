import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { ApiKeySummary } from '../lib/types';
import { formatDateTime } from '../lib/format';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';

export function ApiKeys() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    apiGet<{ apiKeys: ApiKeySummary[] }>('/api-keys')
      .then((res) => setKeys(res.apiKeys))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('apiKeys.loadFailed')));
  }

  useEffect(load, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiPost<{ key: string }>('/api-keys', { name });
      setNewKey(created.key);
      setName('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('apiKeys.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(key: ApiKeySummary) {
    if (!confirm(t('apiKeys.confirmRevoke', { name: key.name }))) return;
    try {
      await apiDelete(`/api-keys/${key.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('apiKeys.revokeFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('apiKeys.title')}</h1>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('apiKeys.introBefore')} (<code className="rounded bg-slate-100 px-1">POST /v1/tickets</code>){t('apiKeys.introAfter')}
      </p>

      {newKey && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-medium text-amber-800">{t('apiKeys.copyNow')}</p>
          <code className="block break-all rounded bg-white px-2 py-1 text-amber-900">{newKey}</code>
        </div>
      )}

      <form onSubmit={onSubmit} className="mb-6 flex items-end gap-2">
        <div className="w-64">
          <Input
            hideLabel
            aria-label={t('apiKeys.keyName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('apiKeys.keyNamePlaceholder')}
            required
          />
        </div>
        <Button type="submit" isLoading={submitting}>
          {t('apiKeys.create')}
        </Button>
      </form>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {keys === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {keys?.length === 0 && <p className="text-sm text-slate-500">{t('apiKeys.empty')}</p>}

      {keys && keys.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[14px] font-semibold text-slate-800">{k.name}</span>
                <div className="flex items-center gap-4 text-[12.5px] text-slate-400">
                  <span>{t('apiKeys.created', { when: formatDateTime(k.createdAt) })}</span>
                  <span>{k.lastUsedAt ? t('apiKeys.lastUsed', { when: formatDateTime(k.lastUsedAt) }) : t('apiKeys.neverUsed')}</span>
                  <button onClick={() => revoke(k)} className="text-xs text-slate-400 hover:text-rose-600">
                    {t('apiKeys.revoke')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
