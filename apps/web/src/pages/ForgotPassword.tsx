import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiPost, ApiError } from '../lib/api';
import { AuthLayout, Field } from '../components/AuthLayout';

/** Asks for a password reset link -- docs/adr/0067-account-self-service.md. */
export function ForgotPassword() {
  const { t } = useTranslation();
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/auth/password/forgot', { tenantSlug: tenantSlug.trim(), email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.forgot.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout tagline={t('auth.login.tagline')} bullets={t('auth.login.bullets', { returnObjects: true }) as string[]}>
      {sent ? (
        <div className="flex flex-col gap-4">
          <h1 className="text-[23px] font-extrabold tracking-tight text-slate-900">{t('auth.forgot.sentTitle')}</h1>
          <p className="text-[13.5px] text-slate-500">{t('auth.forgot.sentBody', { email })}</p>
          <Link to="/login" className="text-[13px] font-semibold text-indigo-600 hover:underline">
            {t('auth.forgot.back')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div>
            <h1 className="mb-1 text-[23px] font-extrabold tracking-tight text-slate-900">{t('auth.forgot.title')}</h1>
            <p className="text-[13.5px] text-slate-400">{t('auth.forgot.subtitle')}</p>
          </div>
          <div className="flex flex-col gap-3.5">
            <Field label={t('auth.fields.orgSlug')} value={tenantSlug} onChange={setTenantSlug} placeholder="acme" />
            <Field label={t('auth.fields.email')} type="email" value={email} onChange={setEmail} placeholder="you@company.com" />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !tenantSlug.trim() || !email.trim()}
            className="w-full rounded-[9px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
          </button>
          <p className="text-center text-[13px] text-slate-400">
            <Link to="/login" className="font-semibold text-indigo-600 hover:underline">
              {t('auth.forgot.back')}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
