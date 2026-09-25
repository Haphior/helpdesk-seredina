import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPatch, apiPost, downloadFile, ApiError } from '../lib/api';
import type { ContactDetail as ContactDetailType } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { BackArrowIcon } from '../components/icons';
import { formatDateTime } from '../lib/format';

/** One contact: their tickets, and their data rights -- docs/adr/0066-contact-data-rights.md. */
export function ContactDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('contacts:manage');
  const [contact, setContact] = useState<ContactDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    apiGet<ContactDetailType>(`/contacts/${id}`)
      .then(setContact)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('contacts.loadFailed')));
  }, [id, t]);

  useEffect(load, [load]);

  async function exportData() {
    if (!id) return;
    setExporting(true);
    setError(null);
    try {
      await downloadFile(`/contacts/${id}/export${includeNotes ? '?internalNotes=true' : ''}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('contacts.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  if (error && !contact) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!contact) return <div className="p-6 text-sm text-slate-500">{t('common.loading')}</div>;
  const anonymized = Boolean(contact.anonymizedAt);

  return (
    <div className="px-9 py-7">
      <Link to="/contacts" className="mb-3.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-600">
        <BackArrowIcon width={15} height={15} />
        {t('contacts.title')}
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{contact.name}</h1>
          {anonymized ? (
            <Badge tone="slate">{t('contacts.anonymizedOn', { date: formatDateTime(contact.anonymizedAt!) })}</Badge>
          ) : (
            <p className="text-[13.5px] text-slate-500">{contact.email}</p>
          )}
        </div>
        {canManage && !anonymized && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('contacts.edit')}
          </Button>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      {notice && <p className="mb-3 text-sm text-emerald-600">{notice}</p>}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">
            {t('contacts.ticketsHeading', { count: contact.tickets.length })}
          </h2>
          {contact.tickets.length === 0 ? (
            <p className="text-[13px] text-slate-400">{t('contacts.noTickets')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {contact.tickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  to={`/tickets/${ticket.id}`}
                  className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-2.5 py-1.5 text-[13px] hover:bg-slate-100"
                >
                  <span className="min-w-0 truncate font-medium text-indigo-700">
                    #{ticket.number} {ticket.subject}
                  </span>
                  <span className="flex-shrink-0 text-xs text-slate-400">
                    {ticket.status.label} · {formatDateTime(ticket.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {canManage && (
          <Card className="!p-5">
            <h2 className="mb-1 text-[15px] font-bold text-slate-800">{t('contacts.rights.title')}</h2>
            <p className="mb-4 text-[13px] text-slate-500">{anonymized ? t('contacts.rights.introAnonymized') : t('contacts.rights.intro')}</p>

            <h3 className="mb-1 text-[13px] font-semibold text-slate-700">{t('contacts.rights.exportTitle')}</h3>
            <p className="mb-2 text-[12.5px] text-slate-500">{t('contacts.rights.exportHint')}</p>
            <label className="mb-2 flex items-start gap-2 text-[12.5px] text-slate-600">
              <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} className="mt-0.5" />
              {t('contacts.rights.includeNotes')}
            </label>
            <Button size="sm" variant="secondary" onClick={exportData} isLoading={exporting}>
              {t('contacts.rights.export')}
            </Button>

            {!anonymized && (
              <>
                <div className="my-4 h-px bg-slate-100" />
                <h3 className="mb-1 text-[13px] font-semibold text-slate-700">{t('contacts.rights.anonymizeTitle')}</h3>
                <p className="mb-2 text-[12.5px] text-slate-500">{t('contacts.rights.anonymizeHint')}</p>
                <Button size="sm" variant="dangerOutline" onClick={() => setAnonymizing(true)}>
                  {t('contacts.rights.anonymize')}
                </Button>
              </>
            )}
          </Card>
        )}
      </div>

      {editing && (
        <EditContactModal
          contact={contact}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
      {anonymizing && (
        <AnonymizeModal
          contact={contact}
          onClose={() => setAnonymizing(false)}
          onDone={(tickets) => {
            setAnonymizing(false);
            setNotice(t('contacts.rights.anonymizedNotice', { count: tickets }));
            load();
          }}
        />
      )}
    </div>
  );
}

function EditContactModal({ contact, onClose, onSaved }: { contact: ContactDetailType; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(contact.name);
  const [email, setEmail] = useState(contact.email);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/contacts/${contact.id}`, { name, email });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('contacts.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t('contacts.editTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label={t('contacts.fields.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label={t('contacts.fields.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AnonymizeModal({ contact, onClose, onDone }: { contact: ContactDetailType; onClose: () => void; onDone: (tickets: number) => void }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const matches = typed.trim().toLowerCase() === contact.email.toLowerCase();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setWorking(true);
    setError(null);
    try {
      const result = await apiPost<{ tickets: number }>(`/contacts/${contact.id}/anonymize`, { confirmEmail: typed });
      onDone(result.tickets);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('contacts.rights.anonymizeFailed'));
      setWorking(false);
    }
  }

  return (
    <Modal title={t('contacts.rights.anonymizeModalTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <p className="text-[13px] text-slate-600">{t('contacts.rights.anonymizeWhat', { count: contact.tickets.length })}</p>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-600">
          <li>{t('contacts.rights.goes1')}</li>
          <li>{t('contacts.rights.goes2')}</li>
          <li>{t('contacts.rights.stays')}</li>
        </ul>
        <p className="text-[13px] font-semibold text-rose-700">{t('contacts.rights.noUndo')}</p>
        <Input
          label={t('contacts.rights.typeEmail', { email: contact.email })}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={!matches} isLoading={working}>
            {t('contacts.rights.anonymizeConfirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
