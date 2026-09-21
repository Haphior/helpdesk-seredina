import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout, Field } from '../components/AuthLayout';
import { ApiError } from '../lib/api';

export function Register() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [tenantSlug, setTenantSlug] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ tenantSlug, tenantName, adminEmail, adminName, password });
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.register.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      tagline={t('auth.register.tagline')}
      bullets={t('auth.register.bullets', { returnObjects: true }) as string[]}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div>
          <h1 className="mb-1 text-[23px] font-extrabold tracking-tight text-slate-900">{t('auth.register.title')}</h1>
          <p className="text-[13.5px] text-slate-400">{t('auth.register.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label={t('auth.fields.orgSlug')} value={tenantSlug} onChange={setTenantSlug} placeholder="acme" />
          <Field label={t('auth.fields.orgName')} value={tenantName} onChange={setTenantName} placeholder="Acme Inc" />
          <Field label={t('auth.fields.yourName')} value={adminName} onChange={setAdminName} />
          <Field label={t('auth.fields.yourEmail')} type="email" value={adminEmail} onChange={setAdminEmail} />
          <Field label={t('auth.fields.password')} type="password" value={password} onChange={setPassword} />
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-[9px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? t('auth.register.submitting') : t('auth.register.submit')}
        </button>

        <p className="text-center text-[13px] text-slate-400">
          {t('auth.register.haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-indigo-600 hover:underline">
            {t('auth.register.signIn')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
