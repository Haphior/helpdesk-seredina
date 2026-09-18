import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, ApiError } from '../lib/api';

interface TenantAiSettings {
  provider: 'anthropic' | 'openai' | 'ollama' | null;
  hasApiKey: boolean;
  model: string | null;
  baseUrl: string | null;
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  ollama: 'Ollama (local, no API key, no per-call cost)',
};

export function AiSettings() {
  const [settings, setSettings] = useState<TenantAiSettings | null>(null);
  const [provider, setProvider] = useState<'anthropic' | 'openai' | 'ollama' | ''>('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function load() {
    apiGet<TenantAiSettings>('/ai-settings')
      .then((res) => {
        setSettings(res);
        setProvider(res.provider ?? '');
        setModel(res.model ?? '');
        setBaseUrl(res.baseUrl ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load AI settings'));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await apiPatch<TenantAiSettings>('/ai-settings', {
        provider: provider || null,
        ...(apiKey ? { apiKey } : {}),
        model: model || null,
        baseUrl: baseUrl || null,
      });
      setSettings(updated);
      setApiKey('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save AI settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm('Clear this tenant\'s AI settings? The deployment-wide default (if any) will be used instead.')) return;
    setError(null);
    try {
      await apiDelete('/ai-settings');
      setProvider('');
      setApiKey('');
      setModel('');
      setBaseUrl('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to clear AI settings');
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">AI Settings</h1>
      <p className="mb-6 max-w-2xl text-[13.5px] text-slate-500">
        Bring your own AI provider and key for this tenant. When set, it takes over completely for
        the AI copilot and autonomous agent — the deployment's own default is never used as a
        fallback, even if this tenant's key is missing. Leave unset to use the deployment default.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {saved && <p className="mb-4 text-sm text-emerald-600">Saved.</p>}

      {!settings ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            >
              <option value="">Use deployment default</option>
              {Object.entries(PROVIDER_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {provider && provider !== 'ollama' && (
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                API key {settings.hasApiKey && <span className="text-slate-400">(currently set — leave blank to keep it)</span>}
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.hasApiKey ? '••••••••••••' : 'sk-...'}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </label>
          )}

          {provider === 'ollama' && (
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Base URL</span>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </label>
          )}

          {provider && (
            <label className="mb-4 block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Model override (optional)</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={provider === 'ollama' ? 'llama3.1' : provider === 'openai' ? 'gpt-4.1' : 'claude-opus-5'}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </label>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleClear}
              className="text-[13px] font-medium text-slate-500 hover:text-rose-600"
            >
              Clear (use deployment default)
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
