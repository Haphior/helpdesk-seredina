import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiGet, apiPut, ApiError } from '../lib/api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

interface PortalSettingsView {
  enabled: boolean;
  url: string;
  hasEmailChannel: boolean;
}

/** Administration → Customer Portal (docs/adr/0065-customer-portal.md). */
export function PortalSettings() {
  const { t } = useTranslation();
  const [view, setView] = useState<PortalSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PortalSettingsView>('/portal-settings')
      .then(setView)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('portalSettings.failed')));
  }, [t]);

  async function toggle() {
    if (!view) return;
    try {
      setView(await apiPut<PortalSettingsView>('/portal-settings', { enabled: !view.enabled }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('portalSettings.failed'));
    }
  }

  return (
    <div className="max-w-2xl px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('portalSettings.title')}</h1>
      <p className="mb-5 text-[13.5px] text-slate-500">{t('portalSettings.intro')}</p>
      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {view && (
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[14px] font-semibold text-slate-800">{view.enabled ? t('portalSettings.on') : t('portalSettings.off')}</p>
              {view.enabled && (
                <a href={view.url} target="_blank" rel="noreferrer" className="text-[13px] text-indigo-600 hover:underline">
                  {view.url}
                </a>
              )}
            </div>
            <Button variant={view.enabled ? 'ghost' : 'primary'} onClick={toggle}>
              {view.enabled ? t('portalSettings.turnOff') : t('portalSettings.turnOn')}
            </Button>
          </div>
          {!view.hasEmailChannel && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              {t('portalSettings.needsEmail')}{' '}
              <Link to="/email-channels" className="font-semibold underline">
                {t('nav.items.emailChannels')}
              </Link>
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
