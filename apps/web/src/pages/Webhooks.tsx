import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { Webhook, WebhookEvent } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { formatDateTime } from '../lib/format';

const ALL_EVENTS: WebhookEvent[] = ['ticket.created', 'ticket.updated', 'message.created'];

export function Webhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  function load() {
    apiGet<{ webhooks: Webhook[] }>('/webhooks')
      .then((res) => setWebhooks(res.webhooks))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load webhooks'));
  }

  useEffect(load, []);

  async function remove(webhook: Webhook) {
    if (!confirm(`Delete webhook for ${webhook.url}?`)) return;
    try {
      await apiDelete(`/webhooks/${webhook.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete webhook');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Webhooks</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New webhook
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Notify an external system when a ticket or message event happens — the opposite direction from the API/alert
        channels. Deliveries are HMAC-signed (<code className="rounded bg-slate-100 px-1">X-Seredina-Signature</code>).
      </p>

      {newSecret && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-medium text-amber-800">Copy this signing secret now. It won't be shown again.</p>
          <code className="block break-all rounded bg-white px-2 py-1 text-amber-900">{newSecret}</code>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {webhooks === null && <p className="text-sm text-slate-500">Loading…</p>}
      {webhooks?.length === 0 && <p className="text-sm text-slate-500">No webhooks configured yet.</p>}

      {webhooks && webhooks.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-slate-800">{w.url}</div>
                  <div className="flex flex-wrap gap-1 text-[12px] text-slate-400">
                    {w.events.map((e) => (
                      <span key={e} className="rounded bg-slate-100 px-1.5 py-0.5">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {w.lastDeliveryStatus && (
                    <Badge tone={w.lastDeliveryStatus === 'success' ? 'emerald' : 'rose'} dot>
                      {w.lastDeliveryStatus} {w.lastDeliveryAt ? formatDateTime(w.lastDeliveryAt) : ''}
                    </Badge>
                  )}
                  <button onClick={() => remove(w)} className="text-xs text-slate-400 hover:text-rose-600">
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
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
    </div>
  );
}

function CreateWebhookModal({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string) => void }) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([]);
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
      const created = await apiPost<{ secret: string }>('/webhooks', { url, events });
      onCreated(created.secret);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create webhook');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New webhook" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhooks/seredina"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-400">Must be https:// — deliveries never go to plain http.</span>
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Events</span>
          <div className="flex flex-col gap-1.5">
            {ALL_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={events.includes(event)} onChange={() => toggleEvent(event)} />
                {event}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || events.length === 0}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
