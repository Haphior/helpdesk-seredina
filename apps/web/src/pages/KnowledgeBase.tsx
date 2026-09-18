import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { KbArticle } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Textarea } from '../components/Textarea';
import { Card } from '../components/Card';
import { SearchIcon } from '../components/icons';
import { formatDateTime } from '../lib/format';

interface Me {
  tenantSlug: string;
}

const PAGE_SIZE = 50;

export function KnowledgeBase() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('tickets:write');
  const [articles, setArticles] = useState<KbArticle[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<KbArticle | 'new' | null>(null);

  function load(query = q, offset = 0) {
    if (offset > 0) setLoadingMore(true);
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    apiGet<{ articles: KbArticle[]; total: number }>(`/kb-articles?${params.toString()}`)
      .then((res) => {
        setArticles((prev) => (offset > 0 && prev ? [...prev, ...res.articles] : res.articles));
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load the knowledge base'))
      .finally(() => setLoadingMore(false));
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
        {canWrite && <Button onClick={() => setEditing('new')}>New article</Button>}
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Published articles are visible to anyone at{' '}
        {tenantSlug ? <code className="rounded bg-slate-100 px-1">/kb/{tenantSlug}</code> : 'your public self-service portal'}{' '}
        — no account needed.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="mb-4 flex gap-2"
      >
        <div className="w-72">
          <Input
            hideLabel
            aria-label="Search title or body"
            icon={<SearchIcon width={15} height={15} />}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or body…"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {articles === null && <p className="text-sm text-slate-500">Loading…</p>}
      {articles?.length === 0 && <p className="text-sm text-slate-500">No articles found.</p>}

      {articles && articles.length > 0 && (
        <Card className="overflow-hidden p-0">
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
        </Card>
      )}

      {articles && articles.length < total && (
        <div className="flex justify-center pt-4">
          <Button variant="secondary" onClick={() => load(q, articles.length)} isLoading={loadingMore}>
            {loadingMore ? 'Loading…' : `Load more (${total - articles.length} remaining)`}
          </Button>
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
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How to reset your password" required />

        <Textarea label="Body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} required />

        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
          />
          Published — visible on the public self-service portal
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
