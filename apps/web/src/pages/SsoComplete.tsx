import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../components/AuthLayout';
import { apiPost, ApiError } from '../lib/api';

/**
 * Where the API sends the browser after a successful single sign-on
 * (docs/adr/0060-sso-oidc.md). The one-time exchange token rides in the URL
 * fragment -- never sent to a server -- and is traded here for a session.
 */
export function SsoComplete() {
  const { t } = useTranslation();
  const { acceptToken } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React strict mode runs effects twice; the token is single-use.
    started.current = true;
    const exchangeToken = window.location.hash.slice(1);
    // Out of the address bar and history right away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!exchangeToken) {
      setError(t('auth.sso.missingToken'));
      return;
    }
    apiPost<{ token: string }>('/auth/sso/exchange', { token: exchangeToken })
      .then(({ token }) => {
        acceptToken(token);
        navigate('/dashboard', { replace: true });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('auth.sso.failed')));
  }, [acceptToken, navigate, t]);

  return (
    <AuthLayout tagline={t('auth.login.tagline')} bullets={t('auth.login.bullets', { returnObjects: true }) as string[]}>
      <div className="flex flex-col gap-4">
        <h1 className="text-[23px] font-extrabold tracking-tight text-slate-900">{t('auth.sso.completing')}</h1>
        {error ? (
          <>
            <p className="text-sm text-rose-600">{error}</p>
            <Link to="/login" className="text-[13px] font-semibold text-indigo-600 hover:underline">
              {t('mfa.back')}
            </Link>
          </>
        ) : (
          <p className="text-sm text-slate-500">{t('common.loading')}</p>
        )}
      </div>
    </AuthLayout>
  );
}
