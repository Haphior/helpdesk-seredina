import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout, Field } from '../components/AuthLayout';
import { CodeInput, MfaEnroll, RecoveryCodes, type MfaSetupData } from '../components/MfaSetup';
import { apiPost, ApiError } from '../lib/api';

type Step =
  | { kind: 'password' }
  | { kind: 'mfa_verify'; mfaToken: string }
  | { kind: 'mfa_setup'; mfaToken: string; setup: MfaSetupData | null }
  | { kind: 'recovery_codes'; codes: string[] };

export function Login() {
  const { t } = useTranslation();
  const { login, acceptToken } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [code, setCode] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await login({ tenantSlug, email, password });
      if (outcome.kind === 'signed_in') {
        navigate('/dashboard');
      } else if (outcome.kind === 'mfa_verify') {
        setStep({ kind: 'mfa_verify', mfaToken: outcome.mfaToken });
      } else {
        setStep({ kind: 'mfa_setup', mfaToken: outcome.mfaToken, setup: null });
        const setup = await apiPost<MfaSetupData>('/auth/login/mfa-setup', { mfaToken: outcome.mfaToken });
        setStep({ kind: 'mfa_setup', mfaToken: outcome.mfaToken, setup });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.login.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMfaCode(e: FormEvent) {
    e.preventDefault();
    if (step.kind !== 'mfa_verify') return;
    setError(null);
    setSubmitting(true);
    try {
      const { token } = await apiPost<{ token: string }>('/auth/login/mfa', { mfaToken: step.mfaToken, code });
      acceptToken(token);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.login.failed'));
      if (err instanceof ApiError && /expired/i.test(err.message)) setStep({ kind: 'password' });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmEnrollment(enrollCode: string) {
    if (step.kind !== 'mfa_setup') return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiPost<{ token: string; recoveryCodes: string[] }>('/auth/login/mfa-setup/confirm', {
        mfaToken: step.mfaToken,
        code: enrollCode,
      });
      acceptToken(res.token);
      setStep({ kind: 'recovery_codes', codes: res.recoveryCodes });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.login.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  const layoutProps = { tagline: t('auth.login.tagline'), bullets: t('auth.login.bullets', { returnObjects: true }) as string[] };

  if (step.kind === 'mfa_verify') {
    return (
      <AuthLayout {...layoutProps}>
        <form onSubmit={submitMfaCode} className="flex flex-col gap-5">
          <div>
            <h1 className="mb-1 text-[23px] font-extrabold tracking-tight text-slate-900">{t('mfa.verify.title')}</h1>
            <p className="text-[13.5px] text-slate-400">{t('mfa.verify.subtitle')}</p>
          </div>
          <CodeInput value={code} onChange={setCode} label={t('mfa.verify.codeOrRecovery')} />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || code.trim().length < 6}
            className="w-full rounded-[9px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? t('mfa.verifying') : t('mfa.verify.submit')}
          </button>
          <button type="button" onClick={() => setStep({ kind: 'password' })} className="text-center text-[13px] text-slate-400 hover:text-slate-600">
            {t('mfa.back')}
          </button>
        </form>
      </AuthLayout>
    );
  }

  if (step.kind === 'mfa_setup') {
    return (
      <AuthLayout {...layoutProps}>
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="mb-1 text-[23px] font-extrabold tracking-tight text-slate-900">{t('mfa.setupRequired.title')}</h1>
            <p className="text-[13.5px] text-slate-400">{t('mfa.setupRequired.subtitle')}</p>
          </div>
          {step.setup ? (
            <MfaEnroll setup={step.setup} onConfirm={confirmEnrollment} submitting={submitting} error={error} />
          ) : (
            <p className="text-sm text-slate-500">{error ?? t('common.loading')}</p>
          )}
        </div>
      </AuthLayout>
    );
  }

  if (step.kind === 'recovery_codes') {
    return (
      <AuthLayout {...layoutProps}>
        <div className="flex flex-col gap-5">
          <h1 className="text-[23px] font-extrabold tracking-tight text-slate-900">{t('mfa.recovery.title')}</h1>
          <RecoveryCodes codes={step.codes} onDone={() => navigate('/dashboard')} />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout tagline={t('auth.login.tagline')} bullets={t('auth.login.bullets', { returnObjects: true }) as string[]}>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div>
          <h1 className="mb-1 text-[23px] font-extrabold tracking-tight text-slate-900">{t('auth.login.title')}</h1>
          <p className="text-[13.5px] text-slate-400">{t('auth.login.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label={t('auth.fields.orgSlug')} value={tenantSlug} onChange={setTenantSlug} placeholder="acme" />
          <Field label={t('auth.fields.email')} type="email" value={email} onChange={setEmail} placeholder="you@company.com" />
          <Field label={t('auth.fields.password')} type="password" value={password} onChange={setPassword} />
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-[9px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
        </button>

        <p className="text-center text-[13px] text-slate-400">
          {t('auth.login.noOrg')}{' '}
          <Link to="/register" className="font-semibold text-indigo-600 hover:underline">
            {t('auth.login.createOne')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
