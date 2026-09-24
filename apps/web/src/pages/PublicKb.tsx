import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { apiGet, ApiError } from '../lib/api';
import type { PublicKbArticleSummary } from '../lib/types';
import { PortalBrand } from '../components/PortalBrand';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { SearchIcon } from '../components/icons';
import { kbAccessHeaders, setStoredKbAccessCode } from '../lib/kbAccessCode';
import { KbAccessGate } from '../components/KbAccessGate';

export function PublicKb() {
  const { t } = useTranslation();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [articles, setArticles] = useState<PublicKbArticleSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codeRequired, setCodeRequired] = useState(false);

  function load(query = q) {
    if (!tenantSlug) return;
    setError(null);
    apiGet<{ articles: PublicKbArticleSummary[] }>(
      `/public/${tenantSlug}/kb-articles${query ? `?q=${encodeURIComponent(query)}` : ''}`,
      { headers: kbAccessHeaders(tenantSlug) },
    )
      .then((res) => {
        setCodeRequired(false);
        setArticles(res.articles);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setCodeRequired(true);
          return;
        }
        setError(err instanceof ApiError ? err.message : t('publicKb.loadFailed'));
      });
  }

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug]);

  if (codeRequired && tenantSlug) {
    return (
      <KbAccessGate
        tenantSlug={tenantSlug}
        onUnlocked={(code) => {
          setStoredKbAccessCode(tenantSlug, code);
          load('');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <PortalBrand tenantSlug={tenantSlug} title={t('publicKb.helpCenter')} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className="mb-6 flex gap-2"
        >
          <div className="flex-1">
            <Input
              hideLabel
              aria-label={t('publicKb.search')}
              icon={<SearchIcon width={16} height={16} />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('publicKb.searchPlaceholder')}
              className="!py-3"
            />
          </div>
          <Button type="submit" variant="secondary" size="lg">
            {t('publicKb.searchButton')}
          </Button>
        </form>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {articles === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
        {articles?.length === 0 && <p className="text-sm text-slate-500">{t('publicKb.noArticles')}</p>}

        {articles && articles.length > 0 && (
          <Card className="overflow-hidden p-0">
            <div className="divide-y divide-slate-100">
              {articles.map((a) => (
                <Link
                  key={a.id}
                  to={`/kb/${tenantSlug}/${a.slug}`}
                  className="block px-5 py-4 text-[14.5px] font-semibold text-slate-800 hover:bg-slate-50"
                >
                  {a.title}
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
