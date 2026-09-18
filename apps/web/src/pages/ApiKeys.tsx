import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { ApiKeySummary } from '../lib/types';
import { formatDateTime } from '../lib/format';

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    apiGet<{ apiKeys: ApiKeySummary[] }>('/api-keys')
      .then((res) => setKeys(res.apiKeys))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load API keys'));
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
      setError(err instanceof ApiError ? err.message : 'Failed to create API key');
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(key: ApiKeySummary) {
    if (!confirm(`Revoke "${key.name}"? Anything using this key stops working immediately.`)) return;
    try {
      await apiDelete(`/api-keys/${key.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke API key');
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">API Keys</h1>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Authenticates the API channel (<code className="rounded bg-slate-100 px-1">POST /v1/tickets</code>), the way an
        external integration creates tickets in Seredina.
      </p>

      {newKey && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-medium text-amber-800">Copy this key now. It won't be shown again.</p>
          <code className="block break-all rounded bg-white px-2 py-1 text-amber-900">{newKey}</code>
        </div>
      )}

      <form onSubmit={onSubmit} className="mb-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. widget-integration)"
          required
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          Create key
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {keys === null && <p className="text-sm text-slate-500">Loading…</p>}
      {keys?.length === 0 && <p className="text-sm text-slate-500">No API keys yet.</p>}

      {keys && keys.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between px-5 py-3.5">
                <span className="text-[14px] font-semibold text-slate-800">{k.name}</span>
                <div className="flex items-center gap-4 text-[12.5px] text-slate-400">
                  <span>Created {formatDateTime(k.createdAt)}</span>
                  <span>{k.lastUsedAt ? `Last used ${formatDateTime(k.lastUsedAt)}` : 'Never used'}</span>
                  <button onClick={() => revoke(k)} className="text-xs text-slate-400 hover:text-rose-600">
                    revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
