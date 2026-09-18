import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, ApiError } from '../lib/api';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';

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
        <Card className="max-w-md !p-5">
          <form onSubmit={handleSave}>
            <div className="mb-3">
              <Select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
                <option value="">Use deployment default</option>
                {Object.entries(PROVIDER_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>

            {provider && provider !== 'ollama' && (
              <div className="mb-3">
                <Input
                  label="API key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings.hasApiKey ? '••••••••••••' : 'sk-...'}
                />
                {settings.hasApiKey && <span className="mt-1 block text-xs text-slate-400">Currently set — leave blank to keep it.</span>}
              </div>
            )}

            {provider === 'ollama' && (
              <div className="mb-3">
                <Input label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
              </div>
            )}

            {provider && (
              <div className="mb-4">
                <Input
                  label="Model override (optional)"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={provider === 'ollama' ? 'llama3.1' : provider === 'openai' ? 'gpt-4.1' : 'claude-opus-5'}
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <button type="button" onClick={handleClear} className="text-[13px] font-medium text-slate-500 hover:text-rose-600">
                Clear (use deployment default)
              </button>
              <Button type="submit" isLoading={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
