import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api';
import { getPortalToken, portalDownload, portalFetch, setPortalToken } from '../lib/portalApi';
import { PortalBrand } from '../components/PortalBrand';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Textarea } from '../components/Textarea';
import { formatDateTime } from '../lib/format';
import type { TicketStatusCategory } from '../lib/types';

// Customer portal -- docs/adr/0063-customer-portal.md. Everything here is
// the contact's view: their own tickets, the public conversation only.

interface PortalTicketSummary {
  id: string;
  number: number;
  subject: string;
  updatedAt: string;
  status: { label: string; category: TicketStatusCategory };
}

interface PortalMessage {
  id: string;
  authorType: 'CONTACT' | 'AGENT' | 'SYSTEM' | 'AI';
  body: string;
  createdAt: string;
  authorUser: { name: string } | null;
  attachments: { id: string; filename: string; sizeBytes: number }[];
}

interface PortalTicket {
  id: string;
  number: number;
  subject: string;
  status: { label: string; category: TicketStatusCategory };
  messages: PortalMessage[];
}

interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
}

const STATUS_TONE: Record<TicketStatusCategory, 'indigo' | 'amber' | 'emerald' | 'slate'> = {
  OPEN: 'indigo',
  PENDING: 'amber',
  RESOLVED: 'emerald',
  CLOSED: 'slate',
};

function Shell({ tenantSlug, children }: { tenantSlug: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signedIn = Boolean(getPortalToken(tenantSlug));
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <PortalBrand tenantSlug={tenantSlug} title={t('portal.title')} />
          {signedIn && (
            <button
              onClick={() => {
                setPortalToken(tenantSlug, null);
                navigate(`/portal/${tenantSlug}`);
              }}
              className="text-[13px] text-slate-500 hover:text-slate-800"
            >
              {t('portal.signOut')}
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** /portal/:tenantSlug -- sign-in, or the contact's tickets. */
export function CustomerPortal() {
  const { tenantSlug = '' } = useParams<{ tenantSlug: string }>();
  const [signedIn, setSignedIn] = useState(() => Boolean(getPortalToken(tenantSlug)));
  return <Shell tenantSlug={tenantSlug}>{signedIn ? <MyTickets tenantSlug={tenantSlug} onSignedOut={() => setSignedIn(false)} /> : <SignIn tenantSlug={tenantSlug} />}</Shell>;
}

function SignIn({ tenantSlug }: { tenantSlug: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await portalFetch(tenantSlug, '/request-link', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? t('portal.notAvailable') : err instanceof ApiError ? err.message : t('portal.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto mt-6 max-w-md p-6">
      {sent ? (
        <>
          <h1 className="mb-2 text-[20px] font-extrabold text-slate-900">{t('portal.checkEmailTitle')}</h1>
          <p className="text-[13.5px] text-slate-600">{t('portal.checkEmail', { email })}</p>
        </>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <h1 className="mb-1 text-[20px] font-extrabold text-slate-900">{t('portal.signInTitle')}</h1>
            <p className="text-[13.5px] text-slate-500">{t('portal.signInIntro')}</p>
          </div>
          <Input label={t('portal.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" isLoading={submitting} className="w-full">
            {t('portal.sendLink')}
          </Button>
        </form>
      )}
    </Card>
  );
}

/** /portal/:tenantSlug/auth#<token> -- where the emailed link lands. */
export function CustomerPortalAuth() {
  const { tenantSlug = '' } = useParams<{ tenantSlug: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // single-use token; strict mode runs effects twice
    started.current = true;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setError(t('portal.linkIncomplete'));
      return;
    }
    portalFetch<{ sessionToken: string }>(tenantSlug, '/redeem', { method: 'POST', body: { token } })
      .then(({ sessionToken }) => {
        setPortalToken(tenantSlug, sessionToken);
        navigate(`/portal/${tenantSlug}`, { replace: true });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('portal.failed')));
  }, [tenantSlug, navigate, t]);

  return (
    <Shell tenantSlug={tenantSlug}>
      <Card className="mx-auto mt-6 max-w-md p-6">
        {error ? (
          <>
            <p className="mb-3 text-sm text-rose-600">{error}</p>
            <Link to={`/portal/${tenantSlug}`} className="text-[13px] font-semibold text-indigo-600 hover:underline">
              {t('portal.requestNewLink')}
            </Link>
          </>
        ) : (
          <p className="text-sm text-slate-500">{t('portal.signingIn')}</p>
        )}
      </Card>
    </Shell>
  );
}

function MyTickets({ tenantSlug, onSignedOut }: { tenantSlug: string; onSignedOut: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<PortalTicketSummary[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    portalFetch<{ tickets: PortalTicketSummary[] }>(tenantSlug, '/tickets')
      .then((r) => setTickets(r.tickets))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) onSignedOut();
        else setError(err instanceof ApiError ? err.message : t('portal.failed'));
      });
    portalFetch<{ items: CatalogItem[] }>(tenantSlug, '/catalog')
      .then((r) => setCatalog(r.items))
      .catch(() => {});
  }, [tenantSlug, onSignedOut, t]);

  useEffect(load, [load]);

  async function requestItem(item: CatalogItem) {
    if (!confirm(t('portal.confirmCatalogRequest', { name: item.name }))) return;
    try {
      const created = await portalFetch<{ id: string }>(tenantSlug, `/catalog/${item.id}/request`, { method: 'POST', body: {} });
      navigate(`/portal/${tenantSlug}/tickets/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('portal.failed'));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold text-slate-900">{t('portal.myRequests')}</h1>
        <Button onClick={() => setComposing(true)}>{t('portal.newRequest')}</Button>
      </div>

      {composing && <NewRequest tenantSlug={tenantSlug} onCancel={() => setComposing(false)} onCreated={(id) => navigate(`/portal/${tenantSlug}/tickets/${id}`)} />}

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {tickets === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {tickets?.length === 0 && <p className="text-sm text-slate-500">{t('portal.noRequests')}</p>}
      {tickets && tickets.length > 0 && (
        <Card className="divide-y divide-slate-100 p-0">
          {tickets.map((tk) => (
            <Link key={tk.id} to={`/portal/${tenantSlug}/tickets/${tk.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-slate-800">{tk.subject}</span>
                <span className="text-[12px] text-slate-400">
                  #{tk.number} · {t('portal.updated', { when: formatDateTime(tk.updatedAt) })}
                </span>
              </span>
              <Badge tone={STATUS_TONE[tk.status.category]} dot>
                {tk.status.label}
              </Badge>
            </Link>
          ))}
        </Card>
      )}

      {catalog.length > 0 && (
        <div>
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-400">{t('portal.catalog')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {catalog.map((item) => (
              <button key={item.id} onClick={() => requestItem(item)} className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300">
                <span className="block text-[14px] font-semibold text-slate-800">{item.name}</span>
                {item.description && <span className="mt-1 block text-[12.5px] text-slate-500">{item.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewRequest({ tenantSlug, onCancel, onCreated }: { tenantSlug: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await portalFetch<{ id: string }>(tenantSlug, '/tickets', { method: 'POST', body: { subject, body } });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('portal.failed'));
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label={t('portal.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={300} />
        <Textarea label={t('portal.describe')} value={body} onChange={(e) => setBody(e.target.value)} required rows={6} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {t('portal.send')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** /portal/:tenantSlug/tickets/:id */
export function CustomerPortalTicket() {
  const { tenantSlug = '', id = '' } = useParams<{ tenantSlug: string; id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<PortalTicket | null>(null);
  const [reply, setReply] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    portalFetch<PortalTicket>(tenantSlug, `/tickets/${id}`)
      .then(setTicket)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) navigate(`/portal/${tenantSlug}`);
        else setError(err instanceof ApiError ? err.message : t('portal.failed'));
      });
  }, [tenantSlug, id, navigate, t]);

  useEffect(load, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const message = await portalFetch<{ id: string }>(tenantSlug, `/tickets/${id}/messages`, { method: 'POST', body: { body: reply } });
      if (file) {
        const form = new FormData();
        form.append('file', file);
        await portalFetch(tenantSlug, `/messages/${message.id}/attachments`, { method: 'POST', form });
      }
      setReply('');
      setFile(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('portal.failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Shell tenantSlug={tenantSlug}>
      <Link to={`/portal/${tenantSlug}`} className="mb-4 inline-block text-[13px] text-slate-500 hover:text-slate-800">
        ← {t('portal.back')}
      </Link>
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      {ticket && (
        <>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[12.5px] text-slate-400">#{ticket.number}</p>
              <h1 className="text-[20px] font-extrabold text-slate-900">{ticket.subject}</h1>
            </div>
            <Badge tone={STATUS_TONE[ticket.status.category]} dot>
              {ticket.status.label}
            </Badge>
          </div>
          <div className="space-y-3">
            {ticket.messages.map((m) => {
              const mine = m.authorType === 'CONTACT';
              return (
                <div key={m.id} className={`rounded-xl border p-4 ${mine ? 'border-slate-200 bg-white' : 'border-indigo-100 bg-indigo-50/60'}`}>
                  <p className="mb-1 text-[12px] text-slate-400">
                    {mine ? t('portal.you') : (m.authorUser?.name ?? t('portal.support'))} · {formatDateTime(m.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap text-[14px] text-slate-800">{m.body}</p>
                  {m.attachments.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => portalDownload(tenantSlug, a.id, a.filename).catch(() => setError(t('portal.failed')))}
                      className="mt-2 block text-[13px] text-indigo-700 hover:underline"
                    >
                      📎 {a.filename}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <Card className="mt-4 p-4">
            <form onSubmit={send} className="space-y-3">
              <Textarea label={t('portal.reply')} value={reply} onChange={(e) => setReply(e.target.value)} required rows={4} />
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px] text-slate-600" />
              <div className="flex justify-end">
                <Button type="submit" isLoading={sending}>
                  {t('portal.send')}
                </Button>
              </div>
            </form>
          </Card>
        </>
      )}
    </Shell>
  );
}
