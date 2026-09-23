import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPut, ApiError } from '../lib/api';
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

const PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;

export function AiSettings() {
  const { t } = useTranslation();
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
      .catch((err) => setError(err instanceof ApiError ? err.message : t('aiSettings.loadFailed')));
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
      setError(err instanceof ApiError ? err.message : t('aiSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm(t('aiSettings.confirmClear'))) return;
    setError(null);
    try {
      await apiDelete('/ai-settings');
      setProvider('');
      setApiKey('');
      setModel('');
      setBaseUrl('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('aiSettings.clearFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('aiSettings.title')}</h1>
      <p className="mb-6 max-w-2xl text-[13.5px] text-slate-500">
        {t('aiSettings.intro')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {saved && <p className="mb-4 text-sm text-emerald-600">{t('aiSettings.saved')}</p>}

      {!settings ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : (
        <Card className="max-w-md !p-5">
          <form onSubmit={handleSave}>
            <div className="mb-3">
              <Select label={t('aiSettings.provider')} value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
                <option value="">{t('aiSettings.useDefault')}</option>
                {PROVIDERS.map((key) => (
                  <option key={key} value={key}>
                    {t(`aiSettings.providers.${key}`)}
                  </option>
                ))}
              </Select>
            </div>

            {provider && provider !== 'ollama' && (
              <div className="mb-3">
                <Input
                  label={t('aiSettings.apiKey')}
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings.hasApiKey ? '••••••••••••' : 'sk-...'}
                />
                {settings.hasApiKey && <span className="mt-1 block text-xs text-slate-400">{t('aiSettings.keySet')}</span>}
              </div>
            )}

            {provider === 'ollama' && (
              <div className="mb-3">
                <Input label={t('aiSettings.baseUrl')} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
              </div>
            )}

            {provider && (
              <div className="mb-4">
                <Input
                  label={t('aiSettings.model')}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={provider === 'ollama' ? 'llama3.1' : provider === 'openai' ? 'gpt-4.1' : 'claude-opus-5'}
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <button type="button" onClick={handleClear} className="text-[13px] font-medium text-slate-500 hover:text-rose-600">
                {t('aiSettings.clear')}
              </button>
              <Button type="submit" isLoading={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <AiTriageSettings />
    </div>
  );
}

type TriageMode = 'off' | 'suggest' | 'auto';

/** AI triage of new tickets -- docs/adr/0061-ai-triage.md. */
function AiTriageSettings() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TriageMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ mode: TriageMode }>('/ai-triage-settings')
      .then((r) => setMode(r.mode))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('aiTriage.failed')));
  }, [t]);

  async function change(next: TriageMode) {
    setError(null);
    try {
      const r = await apiPut<{ mode: TriageMode }>('/ai-triage-settings', { mode: next });
      setMode(r.mode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('aiTriage.failed'));
    }
  }

  return (
    <Card className="mt-6 max-w-md !p-5">
      <h2 className="mb-1 text-[15px] font-bold text-slate-800">{t('aiTriage.title')}</h2>
      <p className="mb-3 text-[13px] text-slate-500">{t('aiTriage.intro')}</p>
      {mode && (
        <div className="space-y-2">
          {(['off', 'suggest', 'auto'] as const).map((m) => (
            <label key={m} className="flex items-start gap-2.5 text-[13px]">
              <input type="radio" name="ai-triage" checked={mode === m} onChange={() => change(m)} className="mt-0.5" />
              <span>
                <span className="block font-semibold text-slate-800">{t(`aiTriage.mode.${m}.label`)}</span>
                <span className="block text-slate-500">{t(`aiTriage.mode.${m}.hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </Card>
  );
}
