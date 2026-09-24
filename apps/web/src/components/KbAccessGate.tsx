import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, ApiError } from '../lib/api';
import { PortalBrand } from './PortalBrand';
import { Button } from './Button';
import { Input } from './Input';
import { Card } from './Card';
import { LockIcon } from './icons';

/**
 * Shown by both PublicKb.tsx and PublicKbArticle.tsx when the tenant has
 * gated its portal behind a shared access code (see
 * docs/adr/0051-kb-portal-access-control.md) -- not a login, just a single
 * passphrase the tenant hands out to whoever should be able to browse.
 * Verifies the code against the article-list route (any public KB route
 * enforces the same portal-wide gate, so it doubles as a plain probe) and
 * hands the now-known-good code back to the caller to store and retry with.
 */
export function KbAccessGate({ tenantSlug, onUnlocked }: { tenantSlug: string; onUnlocked: (code: string) => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiGet(`/public/${tenantSlug}/kb-articles`, { headers: { 'X-Kb-Access-Code': code } });
      onUnlocked(code);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('kbGate.incorrect') : t('kbGate.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-sm">
        <PortalBrand tenantSlug={tenantSlug} title={t('publicKb.helpCenter')} />
        <Card className="!p-6">
          <div className="mb-4 flex items-center gap-2 text-slate-700">
            <LockIcon width={16} height={16} />
            <h1 className="text-[15px] font-semibold">{t('kbGate.title')}</h1>
          </div>
          <form onSubmit={onSubmit} className="space-y-3">
            <Input label={t('kbGate.code')} type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <Button type="submit" className="w-full" isLoading={submitting}>
              {submitting ? t('kbGate.checking') : t('kbGate.continue')}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
