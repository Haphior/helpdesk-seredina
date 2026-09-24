import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import { CHAT_WEBHOOK_EVENTS, type Webhook, type WebhookEvent, type WebhookKind } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { formatDateTime } from '../lib/format';

// Source of truth: packages/shared/src/webhooks.ts's WEBHOOK_EVENTS. Keep in
// sync by hand -- the web app doesn't depend on @seredina/shared. This list
// previously drifted (only 3 of 5 events were offered here), making the two
// SLA-breach events impossible to subscribe to from the UI even though the
// backend already dispatched them.
const ALL_EVENTS: WebhookEvent[] = [
  'ticket.created',
  'ticket.updated',
  'message.created',
  'sla.first_response_breached',
  'sla.resolution_breached',
];


export function Webhooks() {
  const { t } = useTranslation();
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  function load() {
    apiGet<{ webhooks: Webhook[] }>('/webhooks')
      .then((res) => setWebhooks(res.webhooks))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('webhooks.loadFailed')));
  }

  useEffect(load, []);

  async function remove(webhook: Webhook) {
    if (!confirm(t('webhooks.confirmDelete', { url: webhook.url }))) return;
    try {
      await apiDelete(`/webhooks/${webhook.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('webhooks.deleteFailed'));
    }
  }

  async function toggleActive(webhook: Webhook) {
    try {
      await apiPatch(`/webhooks/${webhook.id}`, { isActive: !webhook.isActive });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('webhooks.updateFailed'));
    }
  }

  async function rotateSecret(webhook: Webhook) {
    if (!confirm(t('webhooks.confirmRotate'))) return;
    try {
      const res = await apiPost<{ secret: string }>(`/webhooks/${webhook.id}/rotate-secret`);
      setNewSecret(res.secret);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('webhooks.rotateFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('webhooks.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('webhooks.new')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('webhooks.introBefore')} (<code className="rounded bg-slate-100 px-1">X-Seredina-Signature</code>){t('webhooks.introAfter')}
      </p>

      {newSecret && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-medium text-amber-800">{t('webhooks.copySecret')}</p>
          <code className="block break-all rounded bg-white px-2 py-1 text-amber-900">{newSecret}</code>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {webhooks === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {webhooks?.length === 0 && <p className="text-sm text-slate-500">{t('webhooks.empty')}</p>}

      {webhooks && webhooks.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {webhooks.map((w) => (
              <div key={w.id} className={`flex items-center justify-between px-5 py-3.5 ${!w.isActive ? 'opacity-50' : ''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {w.kind !== 'generic' && <Badge tone="indigo">{t(`webhooks.kind.${w.kind}`)}</Badge>}
                    <span className="truncate text-[14px] font-semibold text-slate-800">{w.url}</span>
                    {!w.isActive && <Badge tone="slate">{t('webhooks.paused')}</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-1 text-[12px] text-slate-400">
                    {w.events.map((e) => (
                      <span key={e} className="rounded bg-slate-100 px-1.5 py-0.5">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  {w.lastDeliveryStatus && (
                    <Badge tone={w.lastDeliveryStatus === 'success' ? 'emerald' : 'rose'} dot>
                      {t(`webhooks.delivery.${w.lastDeliveryStatus}`, { defaultValue: w.lastDeliveryStatus })} {w.lastDeliveryAt ? formatDateTime(w.lastDeliveryAt) : ''}
                    </Badge>
                  )}
                  <button onClick={() => toggleActive(w)} className="text-xs text-slate-400 hover:text-indigo-600">
                    {w.isActive ? t('webhooks.pause') : t('webhooks.resume')}
                  </button>
                  <button onClick={() => setEditing(w)} className="text-xs text-slate-400 hover:text-indigo-600">
                    {t('webhooks.edit')}
                  </button>
                  {w.kind === 'generic' && (
                    <button onClick={() => rotateSecret(w)} className="text-xs text-slate-400 hover:text-indigo-600">
                      {t('webhooks.rotate')}
                    </button>
                  )}
                  <button onClick={() => remove(w)} className="text-xs text-slate-400 hover:text-rose-600">
                    {t('webhooks.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showCreate && (
        <CreateWebhookModal
          onClose={() => setShowCreate(false)}
          onCreated={(secret) => {
            setNewSecret(secret);
            load();
          }}
        />
      )}
      {editing && <EditWebhookModal webhook={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function EditWebhookModal({ webhook, onClose, onSaved }: { webhook: Webhook; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(webhook.url);
  const [events, setEvents] = useState<WebhookEvent[]>(webhook.events);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleEvent(event: WebhookEvent) {
    setEvents((es) => (es.includes(event) ? es.filter((e) => e !== event) : [...es, event]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPatch(`/webhooks/${webhook.id}`, { url, events });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('webhooks.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('webhooks.editTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Input label={t('webhooks.url')} value={url} onChange={(e) => setUrl(e.target.value)} required />
          <span className="mt-1 block text-xs text-slate-400">{t('webhooks.httpsOnly')}</span>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">{t('webhooks.eventsLabel')}</span>
          <div className="flex flex-col gap-1.5">
            {ALL_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-[13px] text-slate-600">
                <input
                  type="checkbox"
                  checked={events.includes(event)}
                  onChange={() => toggleEvent(event)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
                />
                {event} <span className="text-slate-400">— {t(`webhooks.events.${event}`)}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting} disabled={events.length === 0}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const KIND_URL_PLACEHOLDER: Record<WebhookKind, string> = {
  generic: 'https://example.com/webhooks/seredina',
  slack: 'https://hooks.slack.com/services/…',
  teams: 'https://….webhook.office.com/webhookb2/…',
};

function CreateWebhookModal({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string | null) => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<WebhookKind>('generic');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const availableEvents = kind === 'generic' ? ALL_EVENTS : CHAT_WEBHOOK_EVENTS;

  function changeKind(next: WebhookKind) {
    setKind(next);
    // Switching to Slack/Teams drops any selected event outside the curated
    // set (ticket.updated/message.created) rather than silently keeping an
    // invalid selection the server would reject anyway.
    setEvents((es) => es.filter((e) => (next === 'generic' ? true : (CHAT_WEBHOOK_EVENTS as string[]).includes(e))));
  }

  function toggleEvent(event: WebhookEvent) {
    setEvents((es) => (es.includes(event) ? es.filter((e) => e !== event) : [...es, event]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiPost<{ secret: string | null }>('/webhooks', { url, events, kind });
      onCreated(created.secret);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('webhooks.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('webhooks.new')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Select label={t('webhooks.type')} value={kind} onChange={(e) => changeKind(e.target.value as WebhookKind)}>
          <option value="generic">{t('webhooks.kind.genericLong')}</option>
          <option value="slack">Slack</option>
          <option value="teams">Microsoft Teams</option>
        </Select>

        <div>
          <Input label={t('webhooks.url')} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={KIND_URL_PLACEHOLDER[kind]} required />
          <span className="mt-1 block text-xs text-slate-400">{t(`webhooks.help.${kind}`)}</span>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">{t('webhooks.eventsLabel')}</span>
          <div className="flex flex-col gap-1.5">
            {availableEvents.map((event) => (
              <label key={event} className="flex items-center gap-2 text-[13px] text-slate-600">
                <input
                  type="checkbox"
                  checked={events.includes(event)}
                  onChange={() => toggleEvent(event)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
                />
                {event} <span className="text-slate-400">— {t(`webhooks.events.${event}`)}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting} disabled={events.length === 0}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
