import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from '../lib/api';
import type { CustomFieldDefinition, ServiceCatalogItem, Ticket, TicketStatusCategory } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { ClockIcon, SearchIcon } from '../components/icons';
import { PRIORITY_TONE, STATUS_CATEGORY_TONE, formatDateTime, isTicketOverdue } from '../lib/format';

const TABS: { key: TicketStatusCategory | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
];

const CHANNEL_TONE: Record<string, 'rose' | 'slate'> = { alert: 'rose', email: 'slate', api: 'slate' };

const ROW_COLUMNS = '56px 1fr 108px 120px 130px 110px 100px';

export function TicketsQueue() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<TicketStatusCategory | 'ALL'>('ALL');
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRequest, setShowRequest] = useState(false);

  useEffect(() => {
    setError(null);
    const query = tab === 'ALL' ? '' : `?statusCategory=${tab}`;
    apiGet<{ tickets: Ticket[] }>(`/tickets${query}`)
      .then((res) => setTickets(res.tickets))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tickets'));
  }, [tab]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 px-8 pb-5 pt-7">
        <div className="flex items-baseline justify-between gap-2.5">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Tickets</h1>
            {tickets && <span className="text-[13px] text-slate-400">{tickets.length} in this view</span>}
          </div>
          {hasPermission('tickets:write') && (
            <button
              onClick={() => setShowRequest(true)}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              New ticket
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-1 rounded-[9px] bg-slate-100 p-[3px]">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium ${
                  tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex w-[280px] items-center gap-2 rounded-[9px] border border-slate-200 bg-white px-3 py-2">
            <SearchIcon width={15} height={15} className="text-slate-400" />
            <span className="text-[13px] text-slate-400">Search tickets…</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-7">
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {tickets === null && !error && <p className="text-sm text-slate-500">Loading…</p>}
        {tickets?.length === 0 && <p className="text-sm text-slate-500">No tickets here.</p>}

        {tickets && tickets.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div
              className="grid items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400"
              style={{ gridTemplateColumns: ROW_COLUMNS }}
            >
              <span>#</span>
              <span>Subject</span>
              <span>Status</span>
              <span>Priority</span>
              <span>Assignee</span>
              <span>Channel</span>
              <span className="text-right">Updated</span>
            </div>

            <div className="divide-y divide-slate-100">
              {tickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  to={`/tickets/${ticket.id}`}
                  className="grid items-center gap-3 px-5 py-3.5 hover:bg-slate-50"
                  style={{ gridTemplateColumns: ROW_COLUMNS }}
                >
                  <span className="text-[13px] font-medium text-slate-400">{ticket.number}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isTicketOverdue(ticket) && (
                        <span title="SLA overdue">
                          <ClockIcon width={13} height={13} className="flex-shrink-0 text-rose-500" />
                        </span>
                      )}
                      <span className="truncate text-[14px] font-semibold text-slate-800">{ticket.subject}</span>
                    </div>
                    <div className="truncate text-[12.5px] text-slate-400">{ticket.contact.name}</div>
                  </div>
                  <span className="w-fit">
                    <Badge tone={STATUS_CATEGORY_TONE[ticket.status.category]} dot>
                      {ticket.status.label}
                    </Badge>
                  </span>
                  <span className="w-fit">
                    <Badge tone={PRIORITY_TONE[ticket.priority]} dot>
                      {ticket.priority}
                    </Badge>
                  </span>
                  {ticket.assignee ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Avatar name={ticket.assignee.name} size={19} />
                      <span className="truncate text-[12.5px] text-slate-600">{ticket.assignee.name}</span>
                    </div>
                  ) : (
                    <span className="text-[12.5px] text-slate-400">Unassigned</span>
                  )}
                  <span className="w-fit">
                    <Badge tone={CHANNEL_TONE[ticket.channel] ?? 'slate'}>{ticket.channel}</Badge>
                  </span>
                  <span className="text-right text-[12px] text-slate-400">{formatDateTime(ticket.updatedAt)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {showRequest && <RequestFromCatalogModal onClose={() => setShowRequest(false)} />}
    </div>
  );
}

function RequestFromCatalogModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ServiceCatalogItem[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [itemId, setItemId] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [subject, setSubject] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiGet<{ items: ServiceCatalogItem[] }>('/service-catalog-items'),
      apiGet<{ customFields: CustomFieldDefinition[] }>('/custom-fields'),
    ]).then(([i, cf]) => {
      setItems(i.items);
      setItemId(i.items[0]?.id ?? '');
      setCustomFields(cf.customFields);
    });
  }, []);

  const item = items.find((i) => i.id === itemId);
  const itemFields = customFields.filter((f) => item?.customFieldKeys.includes(f.key));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ticket = await apiPost<{ id: string }>(`/service-catalog-items/${itemId}/request`, {
        contactEmail,
        contactName,
        subject: subject || undefined,
        customFields: itemFields.length > 0 ? fieldValues : undefined,
      });
      onClose();
      navigate(`/tickets/${ticket.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New ticket" onClose={onClose}>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">
          No service catalog items yet — an admin can add some on the Service Catalog page.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Request</span>
            <select
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                setFieldValues({});
              }}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.icon ? `${i.icon} ` : ''}
                  {i.name}
                </option>
              ))}
            </select>
            {item?.description && <span className="mt-1 block text-xs text-slate-400">{item.description}</span>}
          </label>

          <div className="flex gap-2">
            <label className="block flex-1 text-sm">
              <span className="mb-1 block font-medium text-slate-700">Requester name</span>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block flex-1 text-sm">
              <span className="mb-1 block font-medium text-slate-700">Requester email</span>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Subject (optional)</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={item?.name}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>

          {itemFields.map((f) => (
            <label key={f.key} className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{f.label}</span>
              {f.fieldType === 'BOOLEAN' ? (
                <input
                  type="checkbox"
                  checked={Boolean(fieldValues[f.key])}
                  onChange={(e) => setFieldValues((v) => ({ ...v, [f.key]: e.target.checked }))}
                  className="ml-1 h-4 w-4 accent-indigo-600"
                />
              ) : f.fieldType === 'SELECT' ? (
                <select
                  value={typeof fieldValues[f.key] === 'string' ? (fieldValues[f.key] as string) : ''}
                  onChange={(e) => setFieldValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {f.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.fieldType === 'NUMBER' ? 'number' : f.fieldType === 'DATE' ? 'date' : 'text'}
                  value={typeof fieldValues[f.key] === 'string' || typeof fieldValues[f.key] === 'number' ? String(fieldValues[f.key]) : ''}
                  onChange={(e) =>
                    setFieldValues((v) => ({ ...v, [f.key]: f.fieldType === 'NUMBER' ? Number(e.target.value) : e.target.value }))
                  }
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              )}
            </label>
          ))}

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !itemId}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create ticket'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
