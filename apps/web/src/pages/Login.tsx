import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout, Field } from '../components/AuthLayout';
import { ApiError } from '../lib/api';

export function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
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
      await login({ tenantSlug, email, password });
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.login.failed'));
    } finally {
      setSubmitting(false);
    }
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
