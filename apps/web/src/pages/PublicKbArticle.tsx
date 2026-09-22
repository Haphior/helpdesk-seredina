import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, ApiError } from '../lib/api';
import type { PublicKbArticle } from '../lib/types';
import { PortalBrand } from '../components/PortalBrand';
import { Card } from '../components/Card';
import { BackArrowIcon } from '../components/icons';
import { formatDateTime } from '../lib/format';
import { kbAccessHeaders, setStoredKbAccessCode } from '../lib/kbAccessCode';
import { KbAccessGate } from '../components/KbAccessGate';

export function PublicKbArticlePage() {
  const { tenantSlug, slug } = useParams<{ tenantSlug: string; slug: string }>();
  const [article, setArticle] = useState<PublicKbArticle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeRequired, setCodeRequired] = useState(false);

  function load() {
    if (!tenantSlug || !slug) return;
    setError(null);
    apiGet<PublicKbArticle>(`/public/${tenantSlug}/kb-articles/${slug}`, { headers: kbAccessHeaders(tenantSlug) })
      .then((a) => {
        setCodeRequired(false);
        setArticle(a);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setCodeRequired(true);
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Article not found');
      });
  }

  useEffect(load, [tenantSlug, slug]);

  if (codeRequired && tenantSlug) {
    return (
      <KbAccessGate
        tenantSlug={tenantSlug}
        onUnlocked={(code) => {
          setStoredKbAccessCode(tenantSlug, code);
          load();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <PortalBrand tenantSlug={tenantSlug} title="Help Center" />

        <Link
          to={`/kb/${tenantSlug}`}
          className="mb-4 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-600"
        >
          <BackArrowIcon width={15} height={15} />
          All articles
        </Link>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {!article && !error && <p className="text-sm text-slate-500">Loading…</p>}

        {article && (
          <Card className="!p-6">
            <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{article.title}</h1>
            <p className="mb-4 text-[12.5px] text-slate-400">Updated {formatDateTime(article.updatedAt)}</p>
            <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-slate-700">{article.body}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
