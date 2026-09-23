import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPut, ApiError } from '../lib/api';
import type { Role } from '../lib/types';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';

type SsoProvider = 'microsoft' | 'google' | 'oidc';

interface SsoSettingsView {
  configured: boolean;
  enabled: boolean;
  provider: SsoProvider | null;
  issuer: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRoleKey: string;
  enforced: boolean;
  redirectUri: string | null;
}

/** Administration → Single sign-on (docs/adr/0060-sso-oidc.md). */
export function SsoSettings() {
  const { t } = useTranslation();
  const [view, setView] = useState<SsoSettingsView | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [provider, setProvider] = useState<SsoProvider>('microsoft');
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [domains, setDomains] = useState('');
  const [autoProvision, setAutoProvision] = useState(false);
  const [defaultRoleKey, setDefaultRoleKey] = useState('agent');
  const [enabled, setEnabled] = useState(false);
  const [enforced, setEnforced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function apply(v: SsoSettingsView) {
    setView(v);
    setProvider(v.provider ?? 'microsoft');
    setIssuer(v.provider === 'google' ? '' : (v.issuer ?? ''));
    setClientId(v.clientId ?? '');
    setClientSecret('');
    setDomains(v.allowedDomains.join(', '));
    setAutoProvision(v.autoProvision);
    setDefaultRoleKey(v.defaultRoleKey);
    setEnabled(v.enabled);
    setEnforced(v.enforced);
  }

  useEffect(() => {
    apiGet<SsoSettingsView>('/sso-settings')
      .then(apply)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('sso.loadFailed')));
    apiGet<{ roles: Role[] }>('/roles')
      .then((r) => setRoles(r.roles))
      .catch(() => {});
  }, [t]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const v = await apiPut<SsoSettingsView>('/sso-settings', {
        enabled,
        provider,
        issuer: provider === 'google' ? '' : issuer.trim(),
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        allowedDomains: domains.split(/[\s,;]+/).filter(Boolean),
        autoProvision,
        defaultRoleKey,
        enforced: enabled && enforced,
      });
      apply(v);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sso.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(t('sso.confirmRemove'))) return;
    try {
      await apiDelete('/sso-settings');
      apply(await apiGet<SsoSettingsView>('/sso-settings'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sso.saveFailed'));
    }
  }

  if (!view) {
    return (
      <div className="px-8 py-7">
        {error ? <p className="text-sm text-rose-600">{error}</p> : <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-2xl px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('sso.title')}</h1>
      <p className="mb-5 text-[13.5px] text-slate-500">{t('sso.intro')}</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-2">
            {(['microsoft', 'google', 'oidc'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={`rounded-lg border px-2 py-2 text-[12.5px] font-semibold ${
                  provider === p ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t(`sso.provider.${p}`)}
              </button>
            ))}
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600">
            <p>{t(`sso.setup.${provider}`)}</p>
            <p className="mt-2 font-semibold text-slate-700">{t('sso.redirectUri')}</p>
            {view.redirectUri ? (
              <code className="block break-all rounded bg-white px-2 py-1 text-[12px] text-slate-800">{view.redirectUri}</code>
            ) : (
              <p className="text-rose-600">{t('sso.redirectUriMissing')}</p>
            )}
          </div>

          {provider === 'microsoft' && (
            <Input label={t('sso.directoryId')} value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" required />
          )}
          {provider === 'oidc' && (
            <Input label={t('sso.issuerUrl')} value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://id.example.com/realms/acme" required />
          )}
          <Input label={t('sso.clientId')} value={clientId} onChange={(e) => setClientId(e.target.value)} required />
          <Input
            label={view.hasClientSecret ? t('sso.clientSecretKeep') : t('sso.clientSecret')}
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            required={!view.hasClientSecret}
          />
          <Input label={t('sso.allowedDomains')} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com, acme.cl" />
        </Card>

        <Card className="space-y-3 p-5">
          <Toggle label={t('sso.autoProvision')} hint={t('sso.autoProvisionHint')} checked={autoProvision} onChange={setAutoProvision} />
          {autoProvision && (
            <Select label={t('sso.defaultRole')} value={defaultRoleKey} onChange={(e) => setDefaultRoleKey(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.key}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
          <Toggle label={t('sso.enabled')} hint={t('sso.enabledHint')} checked={enabled} onChange={setEnabled} />
          <Toggle label={t('sso.enforced')} hint={t('sso.enforcedHint')} checked={enabled && enforced} onChange={setEnforced} disabled={!enabled} />
        </Card>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {saved && <p className="text-sm text-emerald-700">{t('sso.saved')}</p>}

        <div className="flex justify-between gap-2">
          {view.configured ? (
            <Button type="button" variant="ghost" onClick={remove}>
              {t('sso.remove')}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" isLoading={saving}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
      />
      <span>
        <span className="block text-[13.5px] font-semibold text-slate-800">{label}</span>
        <span className="block text-[12.5px] text-slate-500">{hint}</span>
      </span>
    </label>
  );
}
