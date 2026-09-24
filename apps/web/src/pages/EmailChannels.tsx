import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { EmailAuthType, EmailChannel } from '../lib/types';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { formatDateTime } from '../lib/format';

async function startOAuth(channelId: string) {
  const { authorizeUrl } = await apiPost<{ authorizeUrl: string }>(`/email-channels/${channelId}/oauth/authorize`, {});
  window.location.assign(authorizeUrl);
}

export function EmailChannels() {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<EmailChannel[] | null>(null);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [params, setParams] = useSearchParams();

  function load() {
    apiGet<{ emailChannels: EmailChannel[]; oauthRedirectUri: string | null }>('/email-channels')
      .then((res) => {
        setChannels(res.emailChannels);
        setRedirectUri(res.oauthRedirectUri);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('emailChannels.loadFailed')));
  }

  useEffect(load, [t]);

  // The provider's callback lands back here with ?oauth=connected or ?oauth_error=...
  useEffect(() => {
    if (params.get('oauth') === 'connected') setNotice(t('emailChannels.connectedNotice'));
    const oauthError = params.get('oauth_error');
    if (oauthError) setError(t('emailChannels.connectFailed', { error: oauthError }));
    if (params.has('oauth') || params.has('oauth_error')) setParams({}, { replace: true });
  }, [params, setParams, t]);

  async function remove(channel: EmailChannel) {
    if (!confirm(t('emailChannels.confirmDelete', { name: channel.name }))) return;
    try {
      await apiDelete(`/email-channels/${channel.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('emailChannels.deleteFailed'));
    }
  }

  async function reconnect(channel: EmailChannel) {
    try {
      await startOAuth(channel.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('emailChannels.connectFailed', { error: '' }));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('emailChannels.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('emailChannels.newChannel')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">{t('emailChannels.intro')}</p>

      {notice && <p className="mb-4 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {channels === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {channels?.length === 0 && <p className="text-sm text-slate-500">{t('emailChannels.empty')}</p>}

      {channels && channels.length > 0 && (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">{t('emailChannels.name')}</th>
                <th className="px-5 py-2.5">{t('emailChannels.from')}</th>
                <th className="px-5 py-2.5">{t('emailChannels.provider')}</th>
                <th className="px-5 py-2.5">{t('emailChannels.status')}</th>
                <th className="px-5 py-2.5">{t('emailChannels.lastPolled')}</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {channels.map((c) => (
                <tr key={c.id} className="align-top hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-800">{c.name}</td>
                  <td className="px-5 py-3 text-slate-600">{c.fromAddress}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {c.authType === 'password' ? (
                      <span>
                        IMAP {c.imapHost}:{c.imapPort}
                        <br />
                        SMTP {c.smtpHost}:{c.smtpPort}
                      </span>
                    ) : (
                      t(`emailChannels.authType.${c.authType}`)
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.connectionStatus} />
                    {c.lastError && <p className="mt-1 max-w-xs text-xs text-rose-600">{c.lastError}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-400">
                    {c.lastPolledAt ? formatDateTime(c.lastPolledAt) : t('emailChannels.never')}
                  </td>
                  <td className="space-x-3 whitespace-nowrap px-5 py-3 text-right text-xs">
                    {c.authType !== 'password' && (
                      <button onClick={() => reconnect(c)} className="font-semibold text-indigo-600 hover:text-indigo-800">
                        {c.connectionStatus === 'connected' ? t('emailChannels.reconnect') : t('emailChannels.connect')}
                      </button>
                    )}
                    <button onClick={() => remove(c)} className="text-slate-400 hover:text-rose-600">
                      {t('emailChannels.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && (
        <CreateChannelModal redirectUri={redirectUri} onClose={() => setShowCreate(false)} onCreated={load} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: EmailChannel['connectionStatus'] }) {
  const { t } = useTranslation();
  const tone =
    status === 'connected'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'needs_reconnect'
        ? 'bg-rose-50 text-rose-700'
        : 'bg-amber-50 text-amber-700';
  return <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${tone}`}>{t(`emailChannels.statusValue.${status}`)}</span>;
}

function CreateChannelModal({
  redirectUri,
  onClose,
  onCreated,
}: {
  redirectUri: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [authType, setAuthType] = useState<EmailAuthType>('microsoft_oauth');
  const [name, setName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  // OAuth
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [microsoftTenant, setMicrosoftTenant] = useState('');
  // Password
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUsername, setImapUsername] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (authType === 'password') {
        await apiPost('/email-channels', {
          authType,
          name,
          fromAddress,
          imapHost,
          imapPort: Number(imapPort),
          imapSecure,
          imapUsername,
          imapPassword,
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpSecure,
          smtpUsername,
          smtpPassword,
        });
        onCreated();
        onClose();
        return;
      }
      const channel = await apiPost<EmailChannel>('/email-channels', {
        authType,
        name,
        fromAddress,
        clientId,
        clientSecret,
        microsoftTenant: authType === 'microsoft_oauth' ? microsoftTenant.trim() || null : null,
      });
      // Straight on to the provider's consent screen; it redirects back to this page.
      await startOAuth(channel.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('emailChannels.createFailed'));
      setSubmitting(false);
    }
  }

  const providers: EmailAuthType[] = ['microsoft_oauth', 'google_oauth', 'password'];

  return (
    <Modal title={t('emailChannels.newChannelTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-3 gap-2">
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAuthType(p)}
              className={`rounded-lg border px-2 py-2 text-[12.5px] font-semibold ${
                authType === p ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t(`emailChannels.authType.${p}`)}
            </button>
          ))}
        </div>

        <Input label={t('emailChannels.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <Input
          label={authType === 'password' ? t('emailChannels.fromAddress') : t('emailChannels.mailboxAddress')}
          type="email"
          value={fromAddress}
          onChange={(e) => setFromAddress(e.target.value)}
          required
        />

        {authType !== 'password' ? (
          <>
            <div className="rounded-lg bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600">
              <p className="mb-1 font-semibold text-slate-700">{t(`emailChannels.setup.${authType}.title`)}</p>
              <p>{t(`emailChannels.setup.${authType}.steps`)}</p>
              <p className="mt-2 font-semibold text-slate-700">{t('emailChannels.redirectUri')}</p>
              {redirectUri ? (
                <code className="block break-all rounded bg-white px-2 py-1 text-[12px] text-slate-800">{redirectUri}</code>
              ) : (
                <p className="text-rose-600">{t('emailChannels.redirectUriMissing')}</p>
              )}
            </div>
            <Input label={t('emailChannels.clientId')} value={clientId} onChange={(e) => setClientId(e.target.value)} required />
            <Input
              label={t('emailChannels.clientSecret')}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              required
            />
            {authType === 'microsoft_oauth' && (
              <Input
                label={t('emailChannels.microsoftTenant')}
                placeholder="organizations"
                value={microsoftTenant}
                onChange={(e) => setMicrosoftTenant(e.target.value)}
              />
            )}
          </>
        ) : (
          <>
            <div className="border-t border-slate-200 pt-2 text-xs font-medium uppercase text-slate-400">
              {t('emailChannels.inbound')}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input label={t('emailChannels.host')} value={imapHost} onChange={(e) => setImapHost(e.target.value)} required />
              <Input label={t('emailChannels.port')} value={imapPort} onChange={(e) => setImapPort(e.target.value)} required />
            </div>
            <Input label={t('emailChannels.username')} value={imapUsername} onChange={(e) => setImapUsername(e.target.value)} required />
            <Input
              label={t('emailChannels.password')}
              type="password"
              value={imapPassword}
              onChange={(e) => setImapPassword(e.target.value)}
              required
            />
            <Checkbox label={t('emailChannels.useTls')} checked={imapSecure} onChange={setImapSecure} />

            <div className="border-t border-slate-200 pt-2 text-xs font-medium uppercase text-slate-400">
              {t('emailChannels.outbound')}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input label={t('emailChannels.host')} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required />
              <Input label={t('emailChannels.port')} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} required />
            </div>
            <Input label={t('emailChannels.username')} value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} required />
            <Input
              label={t('emailChannels.password')}
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              required
            />
            <Checkbox label={t('emailChannels.useTls')} checked={smtpSecure} onChange={setSmtpSecure} />
          </>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting
              ? t('common.saving')
              : authType === 'password'
                ? t('common.save')
                : t('emailChannels.saveAndConnect')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
      />
      {label}
    </label>
  );
}
