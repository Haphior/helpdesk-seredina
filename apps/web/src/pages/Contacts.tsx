import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPut, ApiError } from '../lib/api';
import type { ContactSummary } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { formatDateTime } from '../lib/format';

/** Contacts and their data rights -- docs/adr/0066-contact-data-rights.md. */
export function Contacts() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('contacts:manage');
  const [contacts, setContacts] = useState<ContactSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (cursor?: string) => {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (cursor) qs.set('cursor', cursor);
      apiGet<{ contacts: ContactSummary[]; nextCursor: string | null }>(`/contacts?${qs.toString()}`)
        .then((r) => {
          setContacts((prev) => (cursor && prev ? [...prev, ...r.contacts] : r.contacts));
          setNextCursor(r.nextCursor);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : t('contacts.loadFailed')));
    },
    [search, t],
  );

  useEffect(() => {
    const handle = setTimeout(() => load(), 200);
    return () => clearTimeout(handle);
  }, [load]);

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('contacts.title')}</h1>
      <p className="mb-5 max-w-2xl text-[13.5px] text-slate-500">{t('contacts.intro')}</p>

      {canManage && <RetentionSettings />}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('contacts.searchPlaceholder')}
        aria-label={t('contacts.searchPlaceholder')}
        className="mb-4 w-72 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-indigo-400"
      />

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {contacts === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {contacts?.length === 0 && <p className="text-sm text-slate-500">{t('contacts.empty')}</p>}

      {contacts && contacts.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">{t('contacts.fields.name')}</th>
                <th className="px-5 py-2.5">{t('contacts.fields.email')}</th>
                <th className="px-5 py-2.5">{t('contacts.fields.tickets')}</th>
                <th className="px-5 py-2.5">{t('contacts.fields.since')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link to={`/contacts/${c.id}`} className="font-semibold text-indigo-700 hover:underline">
                      {c.name}
                    </Link>
                    {c.anonymizedAt && (
                      <span className="ml-2">
                        <Badge tone="slate">{t('contacts.anonymized')}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.anonymizedAt ? '—' : c.email}</td>
                  <td className="px-5 py-3 text-slate-600">{c.ticketCount}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{formatDateTime(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {nextCursor && (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => load(nextCursor)}>
            {t('contacts.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

function RetentionSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<{ days: number | null; minDays: number; maxDays: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiGet<{ days: number | null; minDays: number; maxDays: number }>('/contact-retention')
      .then((s) => {
        setSettings(s);
        setDraft(s.days ? String(s.days) : '');
      })
      .catch(() => {});
  }, []);

  async function save(days: number | null) {
    if (days !== null && !confirm(t('contacts.retention.confirm', { days }))) return;
    setSaving(true);
    setMessage(null);
    try {
      const s = await apiPut<{ days: number | null; minDays: number; maxDays: number }>('/contact-retention', { days });
      setSettings(s);
      setDraft(s.days ? String(s.days) : '');
      setMessage({ ok: true, text: s.days ? t('contacts.retention.savedOn', { days: s.days }) : t('contacts.retention.savedOff') });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : t('contacts.retention.failed') });
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;
  const parsed = Number(draft);
  const valid = Number.isInteger(parsed) && parsed >= settings.minDays && parsed <= settings.maxDays;

  return (
    <Card className="mb-6 max-w-2xl !p-5">
      <h2 className="mb-1 text-[15px] font-bold text-slate-800">{t('contacts.retention.title')}</h2>
      <p className="mb-3 text-[13px] text-slate-500">{t('contacts.retention.intro')}</p>
      <p className="mb-3 text-[13px] font-medium text-slate-700">
        {settings.days ? t('contacts.retention.statusOn', { days: settings.days }) : t('contacts.retention.statusOff')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          {t('contacts.retention.after')}
          <input
            type="number"
            min={settings.minDays}
            max={settings.maxDays}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t('contacts.retention.daysLabel')}
            className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-[13px] outline-none focus:border-indigo-400"
          />
          {t('contacts.retention.days')}
        </label>
        <Button size="sm" disabled={!valid || saving} onClick={() => save(parsed)}>
          {t('common.save')}
        </Button>
        {settings.days !== null && (
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => save(null)}>
            {t('contacts.retention.turnOff')}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">{t('contacts.retention.range', { min: settings.minDays, max: settings.maxDays })}</p>
      {message && <p className={`mt-2 text-sm ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>}
    </Card>
  );
}
