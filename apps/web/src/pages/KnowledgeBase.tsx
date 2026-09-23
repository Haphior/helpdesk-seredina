import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { KbArticle } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Textarea } from '../components/Textarea';
import { Card } from '../components/Card';
import { SearchIcon, ShieldIcon } from '../components/icons';
import { formatDateTime } from '../lib/format';

interface Me {
  tenantSlug: string;
}

interface KbPortalSettings {
  portalEnabled: boolean;
  hasAccessCode: boolean;
}

const PAGE_SIZE = 50;

export function KnowledgeBase() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('tickets:write');
  const canManagePortal = hasPermission('tickets:manage_all');
  const [articles, setArticles] = useState<KbArticle[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<KbArticle | 'new' | null>(null);
  const [portalSettingsOpen, setPortalSettingsOpen] = useState(false);

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
      .catch((err) => setError(err instanceof ApiError ? err.message : t('kb.loadFailed')))
      .finally(() => setLoadingMore(false));
  }

  useEffect(() => {
    load('');
    apiGet<Me>('/auth/me')
      .then((me) => setTenantSlug(me.tenantSlug))
      .catch(() => {});
  }, []);

  async function remove(article: KbArticle) {
    if (!confirm(t('kb.confirmDelete', { title: article.title }))) return;
    try {
      await apiDelete(`/kb-articles/${article.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('kb.deleteFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('kb.title')}</h1>
        <div className="flex items-center gap-2">
          {canManagePortal && (
            <Button variant="secondary" onClick={() => setPortalSettingsOpen(true)}>
              <ShieldIcon width={14} height={14} />
              {t('kb.portalSettings')}
            </Button>
          )}
          {canWrite && <Button onClick={() => setEditing('new')}>{t('kb.newArticle')}</Button>}
        </div>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('kb.introBefore')}{' '}
        {tenantSlug ? <code className="rounded bg-slate-100 px-1">/kb/{tenantSlug}</code> : t('kb.yourPortal')}{' '}
        {t('kb.introAfter')}
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
            aria-label={t('kb.search')}
            icon={<SearchIcon width={15} height={15} />}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('kb.searchPlaceholder')}
          />
        </div>
        <Button type="submit" variant="secondary">
          {t('kb.searchButton')}
        </Button>
      </form>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {articles === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {articles?.length === 0 && <p className="text-sm text-slate-500">{t('kb.empty')}</p>}

      {articles && articles.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {articles.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3.5">
                <button onClick={() => setEditing(a)} className="min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-slate-800">{a.title}</span>
                    <Badge tone={a.published ? 'emerald' : 'slate'}>{a.published ? t('kb.published') : t('kb.draft')}</Badge>
                  </div>
                  <div className="text-[12.5px] text-slate-400">
                    {a.author && <span>{a.author.name} · </span>}
                    {t('kb.updated', { when: formatDateTime(a.updatedAt) })}
                  </div>
                </button>
                {canWrite && (
                  <button onClick={() => remove(a)} className="flex-shrink-0 text-xs text-slate-400 hover:text-rose-600">
                    {t('kb.delete')}
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
            {loadingMore ? t('common.loading') : t('kb.loadMore', { count: total - articles.length })}
          </Button>
        </div>
      )}

      {editing && canWrite && (
        <ArticleModal article={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => load()} />
      )}

      {portalSettingsOpen && canManagePortal && <PortalSettingsModal onClose={() => setPortalSettingsOpen(false)} />}
    </div>
  );
}

function PortalSettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<KbPortalSettings | null>(null);
  const [portalEnabled, setPortalEnabled] = useState(true);
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<KbPortalSettings>('/kb-settings')
      .then((s) => {
        setSettings(s);
        setPortalEnabled(s.portalEnabled);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('kb.portal.loadFailed')));
  }, []);

  async function save() {
    setSubmitting(true);
    setError(null);
    try {
      const body: { portalEnabled: boolean; accessCode?: string } = { portalEnabled };
      if (accessCode.trim()) body.accessCode = accessCode.trim();
      const updated = await apiPatch<KbPortalSettings>('/kb-settings', body);
      setSettings(updated);
      setAccessCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('kb.portal.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function clearAccessCode() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiPatch<KbPortalSettings>('/kb-settings', { accessCode: null });
      setSettings(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('kb.portal.removeFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('kb.portal.title')} onClose={onClose}>
      {!settings && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {settings && (
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-[13px] text-slate-600">
            <input
              type="checkbox"
              checked={portalEnabled}
              onChange={(e) => setPortalEnabled(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
            />
            <span>
              {t('kb.portal.enabled')}
            </span>
          </label>

          <div>
            {settings.hasAccessCode ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-[13px] text-slate-600">{t('kb.portal.codeSet')}</span>
                <Button variant="dangerOutline" size="sm" onClick={clearAccessCode} isLoading={submitting}>
                  {t('kb.portal.remove')}
                </Button>
              </div>
            ) : (
              <Input
                label={t('kb.portal.code')}
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder={t('kb.portal.codePlaceholder')}
              />
            )}
            <p className="mt-1.5 text-[12px] text-slate-400">
              {t('kb.portal.codeHint')}
            </p>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('kb.portal.close')}
            </Button>
            <Button onClick={save} isLoading={submitting}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ArticleModal({ article, onClose, onSaved }: { article: KbArticle | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('kb.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={article ? t('kb.editArticle') : t('kb.newArticle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label={t('kb.fieldTitle')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('kb.titlePlaceholder')} required />

        <Textarea label={t('kb.body')} value={body} onChange={(e) => setBody(e.target.value)} rows={10} required />

        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
          />
          {t('kb.publishedHint')}
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
