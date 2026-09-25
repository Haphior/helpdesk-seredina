import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Badge } from '../components/Badge';
import { CodeInput, MfaEnroll, RecoveryCodes, type MfaSetupData } from '../components/MfaSetup';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../auth/AuthContext';

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  required: boolean;
  recoveryCodesRemaining: number;
}

type Mode = 'idle' | 'enrolling' | 'disabling' | 'regenerating' | { codes: string[] };

/** Every user's own two-factor settings -- docs/adr/0061-mfa-totp.md. */
export function AccountSecurity() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetupData | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  function load() {
    apiGet<MfaStatus>('/auth/mfa')
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('accountSecurity.loadFailed')));
  }
  useEffect(load, [t]);

  function reset() {
    setMode('idle');
    setSetup(null);
    setPassword('');
    setCode('');
    setError(null);
  }

  async function startEnroll() {
    setError(null);
    try {
      setSetup(await apiPost<MfaSetupData>('/auth/mfa/setup', {}));
      setMode('enrolling');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('accountSecurity.actionFailed'));
    }
  }

  async function run<T>(fn: () => Promise<T>, after: (r: T) => void) {
    setError(null);
    setSubmitting(true);
    try {
      after(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('accountSecurity.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const confirmEnroll = (enrollCode: string) =>
    run(
      () => apiPost<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code: enrollCode }),
      (r) => {
        setSetup(null);
        setMode({ codes: r.recoveryCodes });
        load();
      },
    );

  const disable = (e: FormEvent) => {
    e.preventDefault();
    return run(() => apiPost('/auth/mfa/disable', { password }), () => {
      reset();
      load();
    });
  };

  const regenerate = (e: FormEvent) => {
    e.preventDefault();
    return run(
      () => apiPost<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code }),
      (r) => {
        setCode('');
        setMode({ codes: r.recoveryCodes });
        load();
      },
    );
  };

  return (
    <div className="max-w-2xl px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('accountSecurity.title')}</h1>
      <p className="mb-5 text-[13.5px] text-slate-500">{t('accountSecurity.intro')}</p>

      {status === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {status && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-bold text-slate-800">{t('accountSecurity.mfaTitle')}</h2>
            {status.enabled ? (
              <Badge tone="emerald" dot>
                {t('accountSecurity.on')}
              </Badge>
            ) : (
              <Badge tone="slate">{t('accountSecurity.off')}</Badge>
            )}
          </div>

          {typeof mode === 'object' ? (
            <RecoveryCodes codes={mode.codes} onDone={reset} />
          ) : mode === 'enrolling' && setup ? (
            <MfaEnroll setup={setup} onConfirm={confirmEnroll} submitting={submitting} error={error} />
          ) : mode === 'disabling' ? (
            <form onSubmit={disable} className="space-y-3">
              <p className="text-[13px] text-slate-600">{t('accountSecurity.disableExplain')}</p>
              <Input label={t('accountSecurity.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={reset}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" isLoading={submitting}>
                  {t('accountSecurity.disable')}
                </Button>
              </div>
            </form>
          ) : mode === 'regenerating' ? (
            <form onSubmit={regenerate} className="space-y-3">
              <p className="text-[13px] text-slate-600">{t('accountSecurity.regenerateExplain')}</p>
              <CodeInput value={code} onChange={setCode} label={t('mfa.codeLabel')} />
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={reset}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" isLoading={submitting}>
                  {t('accountSecurity.regenerate')}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-[13px] text-slate-600">
                {status.enabled
                  ? t('accountSecurity.enabledSince', { date: status.enabledAt ? formatDateTime(status.enabledAt) : '' })
                  : t('accountSecurity.offExplain')}
              </p>
              {status.enabled && (
                <p className={`mt-1 text-[13px] ${status.recoveryCodesRemaining <= 2 ? 'text-amber-700' : 'text-slate-500'}`}>
                  {t('accountSecurity.recoveryRemaining', { count: status.recoveryCodesRemaining })}
                </p>
              )}
              {status.required && <p className="mt-1 text-[13px] text-slate-500">{t('accountSecurity.requiredByWorkspace')}</p>}
              {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {!status.enabled && <Button onClick={startEnroll}>{t('accountSecurity.turnOn')}</Button>}
                {status.enabled && (
                  <>
                    <Button variant="ghost" onClick={() => setMode('regenerating')}>
                      {t('accountSecurity.newRecoveryCodes')}
                    </Button>
                    <Button variant="ghost" onClick={startEnroll}>
                      {t('accountSecurity.newDevice')}
                    </Button>
                    {!status.required && (
                      <Button variant="ghost" onClick={() => setMode('disabling')}>
                        {t('accountSecurity.turnOff')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </Card>
      )}

      <ChangePassword />
    </div>
  );
}

/** Changing your own password -- docs/adr/0067-account-self-service.md. */
function ChangePassword() {
  const { t } = useTranslation();
  const { acceptToken } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next !== confirm) {
      setError(t('auth.setPassword.mismatch'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Other sessions end; this one continues with the fresh token.
      const res = await apiPost<{ token: string }>('/auth/password', { currentPassword: current, newPassword: next });
      acceptToken(res.token);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('accountSecurity.password.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-6 p-5">
      <h2 className="mb-1 text-[15px] font-bold text-slate-800">{t('accountSecurity.password.title')}</h2>
      <p className="mb-4 text-[13px] text-slate-500">{t('accountSecurity.password.intro')}</p>
      <form onSubmit={onSubmit} className="max-w-sm space-y-3">
        <Input label={t('accountSecurity.password.current')} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        <Input label={t('accountSecurity.password.new')} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        <Input label={t('accountSecurity.password.confirm')} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {done && <p className="text-sm text-emerald-600">{t('accountSecurity.password.done')}</p>}
        <Button type="submit" isLoading={submitting}>
          {t('accountSecurity.password.submit')}
        </Button>
      </form>
    </Card>
  );
}
