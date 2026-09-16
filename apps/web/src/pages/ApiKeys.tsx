import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, ApiError } from '../lib/api';
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

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">API Keys</h1>
      <p className="mb-4 text-sm text-slate-500">
        Authenticates the API channel (<code className="rounded bg-slate-100 px-1">POST /v1/tickets</code>), the way
        an external integration creates tickets in Seredina.
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
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Create key
        </button>
      </form>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {keys && (
        <table className="w-full max-w-2xl text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="border-b border-slate-200 py-2 font-medium">Name</th>
              <th className="border-b border-slate-200 py-2 font-medium">Created</th>
              <th className="border-b border-slate-200 py-2 font-medium">Last used</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="border-b border-slate-100 py-2">{k.name}</td>
                <td className="border-b border-slate-100 py-2 text-slate-500">{formatDateTime(k.createdAt)}</td>
                <td className="border-b border-slate-100 py-2 text-slate-500">
                  {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
