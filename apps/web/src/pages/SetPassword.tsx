import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiPost, ApiError } from '../lib/api';
import { AuthLayout, Field } from '../components/AuthLayout';

interface TokenInfo {
  kind: 'reset' | 'invite';
  email: string;
  name: string;
  tenantSlug: string;
  tenantName: string;
}

/**
 * Choosing a password from an emailed link: a password reset or an invitation
 * (docs/adr/0067-account-self-service.md). The token rides in the URL fragment,
 * which is read once and cleared so it doesn't linger in the address bar.
 */
export function SetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [token] = useState(() => window.location.hash.slice(1));
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setLinkError(t('auth.setPassword.invalidLink'));
      return;
    }
    apiPost<TokenInfo>('/auth/password/token', { token })
      .then(setInfo)
      .catch((err) => setLinkError(err instanceof ApiError ? err.message : t('auth.setPassword.invalidLink')));
  }, [token, t]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('auth.setPassword.mismatch'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const done = await apiPost<{ tenantSlug: string; email: string }>('/auth/password/set', { token, password });
      const qs = new URLSearchParams({ org: done.tenantSlug, email: done.email, passwordSet: '1' });
      navigate(`/login?${qs.toString()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.setPassword.failed'));
      setSubmitting(false);
    }
  }

  const layout = { tagline: t('auth.login.tagline'), bullets: t('auth.login.bullets', { returnObjects: true }) as string[] };

  if (linkError) {
    return (
      <AuthLayout {...layout}>
        <div className="flex flex-col gap-4">
          <h1 className="text-[23px] font-extrabold tracking-tight text-slate-900">{t('auth.setPassword.linkProblem')}</h1>
          <p className="text-[13.5px] text-slate-500">{linkError}</p>
          <Link to="/forgot-password" className="text-[13px] font-semibold text-indigo-600 hover:underline">
            {t('auth.setPassword.askNew')}
          </Link>
        </div>
      </AuthLayout>
    );
  }
  if (!info) {
    return (
      <AuthLayout {...layout}>
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout {...layout}>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div>
          <h1 className="mb-1 text-[23px] font-extrabold tracking-tight text-slate-900">
            {info.kind === 'invite' ? t('auth.setPassword.inviteTitle', { org: info.tenantName }) : t('auth.setPassword.resetTitle')}
          </h1>
          <p className="text-[13.5px] text-slate-400">{t('auth.setPassword.for', { email: info.email, org: info.tenantSlug })}</p>
        </div>
        <div className="flex flex-col gap-3.5">
          <Field label={t('auth.setPassword.new')} type="password" value={password} onChange={setPassword} />
          <Field label={t('auth.setPassword.confirm')} type="password" value={confirm} onChange={setConfirm} />
          <p className="text-xs text-slate-400">{t('auth.setPassword.rules')}</p>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting || password.length < 8}
          className="w-full rounded-[9px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? t('common.saving') : t('auth.setPassword.submit')}
        </button>
      </form>
    </AuthLayout>
  );
}
