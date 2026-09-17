import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { KbArticle } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { formatDateTime } from '../lib/format';

interface Me {
  tenantSlug: string;
}

export function KnowledgeBase() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('tickets:write');
  const [articles, setArticles] = useState<KbArticle[] | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<KbArticle | 'new' | null>(null);

  function load(query = q) {
    apiGet<{ articles: KbArticle[] }>(`/kb-articles${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      .then((res) => setArticles(res.articles))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load the knowledge base'));
  }

  useEffect(() => {
    load('');
    apiGet<Me>('/auth/me')
      .then((me) => setTenantSlug(me.tenantSlug))
      .catch(() => {});
  }, []);

  async function remove(article: KbArticle) {
    if (!confirm(`Delete "${article.title}"?`)) return;
    try {
      await apiDelete(`/kb-articles/${article.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete article');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Knowledge Base</h1>
        {canWrite && (
          <button
            onClick={() => setEditing('new')}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            New article
          </button>
        )}
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Published articles are visible to anyone at{' '}
        {tenantSlug ? <code className="rounded bg-slate-100 px-1">/kb/{tenantSlug}</code> : 'your public self-service portal'}{' '}
        — no account needed.
      </p>

      <div className="mb-4 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Search title or body…"
          className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button onClick={() => load()} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          Search
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {articles === null && <p className="text-sm text-slate-500">Loading…</p>}
      {articles?.length === 0 && <p className="text-sm text-slate-500">No articles found.</p>}

      {articles && articles.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {articles.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3.5">
                <button onClick={() => setEditing(a)} className="min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-slate-800">{a.title}</span>
                    <Badge tone={a.published ? 'emerald' : 'slate'}>{a.published ? 'Published' : 'Draft'}</Badge>
                  </div>
                  <div className="text-[12.5px] text-slate-400">
                    {a.author && <span>{a.author.name} · </span>}
                    updated {formatDateTime(a.updatedAt)}
                  </div>
                </button>
                {canWrite && (
                  <button onClick={() => remove(a)} className="flex-shrink-0 text-xs text-slate-400 hover:text-rose-600">
                    delete
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && canWrite && (
        <ArticleModal article={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => load()} />
      )}
    </div>
  );
}

function ArticleModal({ article, onClose, onSaved }: { article: KbArticle | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(article?.title ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [published, setPublished] = useState(article?.published ?? false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (article) {
        await apiPatch(`/kb-articles/${article.id}`, { title, body, published });
      } else {
        await apiPost('/kb-articles', { title, body, published });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save article');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={article ? 'Edit article' : 'New article'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="How to reset your password"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Published — visible on the public self-service portal
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
