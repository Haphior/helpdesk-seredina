import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiGet, ApiError } from '../lib/api';
import type { PublicKbArticleSummary } from '../lib/types';
import { Logo } from '../components/Logo';

export function PublicKb() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [articles, setArticles] = useState<PublicKbArticleSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load(query = q) {
    if (!tenantSlug) return;
    apiGet<{ articles: PublicKbArticleSummary[] }>(
      `/public/${tenantSlug}/kb-articles${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    )
      .then((res) => setArticles(res.articles))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load the help center'));
  }

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug]);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-2.5">
          <Logo size={28} />
          <span className="text-[15px] font-bold text-slate-900">Help Center</span>
        </div>

        <div className="mb-6 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Search articles…"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[14px] shadow-sm"
          />
          <button
            onClick={() => load()}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[14px] font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            Search
          </button>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {articles === null && !error && <p className="text-sm text-slate-500">Loading…</p>}
        {articles?.length === 0 && <p className="text-sm text-slate-500">No articles found.</p>}

        {articles && articles.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
          </div>
        )}
      </div>
    </div>
  );
}
