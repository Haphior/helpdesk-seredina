import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import { useLiveEvents, useLiveStatus } from '../lib/live';
import type {
  CustomFieldDefinition,
  SavedView,
  ServiceCatalogItem,
  Ticket,
  TicketPriority,
  TicketStatus,
  TicketStatusCategory,
  UserSummary,
} from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { TicketSlaCell } from '../components/SlaCountdown';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { ChannelGlyph } from '../components/ChannelGlyph';
import { ClockIcon, SearchIcon } from '../components/icons';
import { PRIORITY_TONE, STATUS_CATEGORY_TONE, formatDateTime, isTicketOverdue } from '../lib/format';
import { useTheme } from '../theme/ThemeContext';

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const TABS: { key: TicketStatusCategory | 'ALL'; labelKey: string }[] = [
  { key: 'ALL', labelKey: 'all' },
  { key: 'OPEN', labelKey: 'open' },
  { key: 'PENDING', labelKey: 'pending' },
  { key: 'RESOLVED', labelKey: 'resolved' },
  { key: 'CLOSED', labelKey: 'closed' },
];

const CHANNEL_TONE: Record<string, 'rose' | 'slate'> = { alert: 'rose', email: 'slate', api: 'slate' };

const ROW_COLUMNS = '24px 56px 1fr 108px 110px 118px 130px 110px 100px';

const PAGE_SIZE = 50;

export function TicketsQueue() {
  const { t } = useTranslation();
  const { hasPermission, payload } = useAuth();
  const { theme } = useTheme();
  const canBulkEdit = hasPermission('tickets:write');
  const [tab, setTab] = useState<TicketStatusCategory | 'ALL'>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState(''); // '' | 'unassigned' | a user id
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | ''>('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [showSaveView, setShowSaveView] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<TicketStatus[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [applyingBulk, setApplyingBulk] = useState(false);

  // Debounced so every keystroke doesn't fire a request -- 300ms is the usual
  // sweet spot between "feels instant" and "not a request per letter."
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  function ticketQuery(offset: number, limit: number) {
    const params = new URLSearchParams();
    if (tab !== 'ALL') params.set('statusCategory', tab);
    if (assigneeFilter) params.set('assigneeId', assigneeFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (debouncedQ) params.set('q', debouncedQ);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return params;
  }

  function load(offset = 0) {
    setError(null);
    if (offset > 0) setLoadingMore(true);
    const params = ticketQuery(offset, PAGE_SIZE);
    apiGet<{ tickets: Ticket[]; total: number }>(`/tickets?${params.toString()}`)
      .then((res) => {
        setTickets((prev) => (offset > 0 && prev ? [...prev, ...res.tickets] : res.tickets));
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('tickets.loadFailed')))
      .finally(() => setLoadingMore(false));
  }

  // Live updates (docs/adr/0053-live-updates.md): events only say WHICH ticket
  // changed, so collect them for a moment and refetch what's on screen once --
  // an alert storm becomes one request, not one per event. Rows that changed
  // or appeared get a brief highlight.
  const liveStatus = useLiveStatus();
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const changedIds = useRef(new Set<string>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownIds = useRef(new Set<string>());
  shownIds.current = new Set(tickets?.map((ticket) => ticket.id) ?? []);
  const shownCount = useRef(0);
  shownCount.current = tickets?.length ?? 0;

  function refreshLive() {
    refreshTimer.current = null;
    const changed = changedIds.current;
    changedIds.current = new Set();
    const previous = shownIds.current;
    apiGet<{ tickets: Ticket[]; total: number }>(`/tickets?${ticketQuery(0, Math.max(PAGE_SIZE, shownCount.current)).toString()}`)
      .then((res) => {
        setTickets(res.tickets);
        setTotal(res.total);
        const flash = new Set(res.tickets.filter((ticket) => changed.has(ticket.id) || !previous.has(ticket.id)).map((ticket) => ticket.id));
        if (flash.size > 0) {
          setFlashIds(flash);
          setTimeout(() => setFlashIds(new Set()), 2500);
        }
      })
      .catch(() => {});
  }

  useLiveEvents((event) => {
    if (event.type === 'notification.created') return;
    if ('ticketId' in event) changedIds.current.add(event.ticketId);
    if (!refreshTimer.current) refreshTimer.current = setTimeout(refreshLive, 400);
  });

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  function loadSavedViews() {
    apiGet<{ views: SavedView[] }>('/saved-views')
      .then((res) => setSavedViews(res.views))
      .catch(() => {});
  }

  useEffect(() => {
    load(0);
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, assigneeFilter, priorityFilter, debouncedQ]);

  useEffect(() => {
    apiGet<{ statuses: TicketStatus[] }>('/ticket-statuses').then((res) => setStatuses(res.statuses)).catch(() => {});
    apiGet<{ users: UserSummary[] }>('/users').then((res) => setUsers(res.users)).catch(() => {});
    loadSavedViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applySavedView(view: SavedView) {
    setTab(view.filters.statusCategory ?? 'ALL');
    setAssigneeFilter(view.filters.assigneeId ?? '');
    setPriorityFilter(view.filters.priority ?? '');
  }

  async function removeSavedView(id: string) {
    try {
      await apiDelete(`/saved-views/${id}`);
      loadSavedViews();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tickets.removeSavedViewFailed'));
    }
  }

  const hasActiveFilters = tab !== 'ALL' || assigneeFilter !== '' || priorityFilter !== '';

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!tickets) return;
    setSelected((s) => (s.size === tickets.length ? new Set() : new Set(tickets.map((t) => t.id))));
  }

  // Loops over the existing single-ticket PATCH -- see
  // docs/adr/0019-collision-merge-bulk-actions.md: bulk actions are UI over
  // updateTicket, not new backend logic.
  async function applyBulk(data: Record<string, unknown>) {
    setApplyingBulk(true);
    try {
      await Promise.all([...selected].map((id) => apiPatch(`/tickets/${id}`, data)));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tickets.bulk.updateFailed'));
    } finally {
      setApplyingBulk(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 px-8 pb-5 pt-7">
        <div className="flex items-baseline justify-between gap-2.5">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('tickets.title')}</h1>
            {tickets && (
              <span className="text-[13px] text-slate-400">
                {t('tickets.countOfTotal', { count: tickets.length, total })}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 self-center text-[11.5px] font-semibold ${
                liveStatus === 'live' ? 'text-emerald-600' : 'text-slate-400'
              }`}
              title={t(`tickets.live.${liveStatus}Hint`)}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full bg-current ${liveStatus === 'live' ? 'animate-pulse' : ''}`}
              />
              {t(`tickets.live.${liveStatus}`)}
            </span>
          </div>
          {hasPermission('tickets:write') && <Button onClick={() => setShowRequest(true)}>{t('tickets.newTicket')}</Button>}
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-1 rounded-[9px] bg-slate-100 p-[3px]">
            {TABS.map((tabItem) => (
              <button
                key={tabItem.key}
                onClick={() => setTab(tabItem.key)}
                className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium ${
                  tab === tabItem.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t(`tickets.tabs.${tabItem.labelKey}`)}
              </button>
            ))}
          </div>

          <div className="w-[280px]">
            <Input
              hideLabel
              aria-label={t('tickets.searchLabel')}
              icon={<SearchIcon width={15} height={15} />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('tickets.searchPlaceholder')}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {savedViews.map((v) => (
            <span
              key={v.id}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white pl-3 pr-1.5 py-1 text-[12.5px] font-medium text-slate-600"
            >
              <button onClick={() => applySavedView(v)} className="hover:text-indigo-700">
                {v.name}
              </button>
              <button onClick={() => removeSavedView(v.id)} className="text-slate-300 hover:text-rose-600">
                ×
              </button>
            </span>
          ))}

          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="rounded-[7px] border border-slate-200 bg-white px-2 py-1 text-[12.5px] text-slate-600"
          >
            <option value="">{t('tickets.filters.anyone')}</option>
            {payload && <option value={payload.sub}>{t('tickets.filters.assignedToMe')}</option>}
            <option value="unassigned">{t('common.unassigned')}</option>
            {users.filter((u) => u.id !== payload?.sub).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as TicketPriority | '')}
            className="rounded-[7px] border border-slate-200 bg-white px-2 py-1 text-[12.5px] text-slate-600"
          >
            <option value="">{t('tickets.filters.anyPriority')}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {hasActiveFilters && (
            <button onClick={() => setShowSaveView(true)} className="text-[12.5px] font-medium text-indigo-600 hover:underline">
              {t('tickets.filters.saveThisView')}
            </button>
          )}
        </div>

        {canBulkEdit && selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-[9px] border border-indigo-200 bg-indigo-50 px-3.5 py-2">
            <span className="text-[13px] font-semibold text-indigo-700">{t('tickets.bulk.selected', { count: selected.size })}</span>
            <select
              defaultValue=""
              disabled={applyingBulk}
              onChange={(e) => e.target.value && applyBulk({ assigneeId: e.target.value })}
              className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs text-slate-600"
            >
              <option value="" disabled>
                {t('tickets.bulk.assignTo')}
              </option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              disabled={applyingBulk}
              onChange={(e) => e.target.value && applyBulk({ statusId: e.target.value })}
              className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs text-slate-600"
            >
              <option value="" disabled>
                {t('tickets.bulk.setStatus')}
              </option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              disabled={applyingBulk}
              onChange={(e) => e.target.value && applyBulk({ priority: e.target.value })}
              className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs text-slate-600"
            >
              <option value="" disabled>
                {t('tickets.bulk.setPriority')}
              </option>
              {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {applyingBulk && <span className="text-xs text-indigo-500">{t('tickets.bulk.applying')}</span>}
            <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-indigo-600 hover:underline">
              {t('tickets.bulk.clearSelection')}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-7">
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {tickets === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
        {tickets?.length === 0 && <p className="text-sm text-slate-500">{t('tickets.empty')}</p>}

        {tickets && tickets.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div
              className="grid items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400"
              style={{ gridTemplateColumns: ROW_COLUMNS }}
            >
              <span>
                {canBulkEdit && (
                  <input
                    type="checkbox"
                    checked={selected.size === tickets.length}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 accent-indigo-600"
                  />
                )}
              </span>
              <span>#</span>
              <span>{t('tickets.table.subject')}</span>
              <span>{t('tickets.table.status')}</span>
              <span>{t('tickets.table.priority')}</span>
              <span>{t('tickets.table.sla')}</span>
              <span>{t('tickets.table.assignee')}</span>
              <span>{t('tickets.table.channel')}</span>
              <span className="text-right">{t('tickets.table.updated')}</span>
            </div>

            <div className="divide-y divide-slate-100">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className={`grid items-center gap-3 px-5 py-3.5 hover:bg-slate-50 ${flashIds.has(ticket.id) ? 'live-flash' : ''}`}
                  style={{ gridTemplateColumns: ROW_COLUMNS }}
                >
                  <span>
                    {canBulkEdit && (
                      <input
                        type="checkbox"
                        checked={selected.has(ticket.id)}
                        onChange={() => toggleSelected(ticket.id)}
                        className="h-3.5 w-3.5 accent-indigo-600"
                      />
                    )}
                  </span>
                  <Link to={`/tickets/${ticket.id}`} className="contents">
                    <span className="text-[13px] font-medium text-slate-400">{ticket.number}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isTicketOverdue(ticket) && (
                          <span title={t('tickets.table.slaOverdue')}>
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
                    <TicketSlaCell ticket={ticket} />
                    {ticket.assignee ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Avatar name={ticket.assignee.name} size={19} />
                        <span className="truncate text-[12.5px] text-slate-600">{ticket.assignee.name}</span>
                      </div>
                    ) : (
                      <span className="text-[12.5px] text-slate-400">{t('common.unassigned')}</span>
                    )}
                    <span className="flex w-fit items-center gap-1.5">
                      {theme !== 'refined' && <ChannelGlyph channel={ticket.channel} />}
                      <Badge tone={CHANNEL_TONE[ticket.channel] ?? 'slate'}>{ticket.channel}</Badge>
                    </span>
                    <span className="text-right text-[12px] text-slate-400">{formatDateTime(ticket.updatedAt)}</span>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {tickets && tickets.length < total && (
          <div className="flex justify-center pt-4">
            <button
              onClick={() => load(tickets.length)}
              disabled={loadingMore}
              className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-[13px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingMore ? t('common.loading') : t('tickets.loadMore', { count: total - tickets.length })}
            </button>
          </div>
        )}
      </div>

      {showRequest && <NewTicketModal onClose={() => setShowRequest(false)} />}
      {showSaveView && (
        <SaveViewModal
          filters={{
            statusCategory: tab === 'ALL' ? undefined : tab,
            assigneeId: assigneeFilter || undefined,
            priority: priorityFilter || undefined,
          }}
          onClose={() => setShowSaveView(false)}
          onSaved={loadSavedViews}
        />
      )}
    </div>
  );
}

function SaveViewModal({
  filters,
  onClose,
  onSaved,
}: {
  filters: { statusCategory?: TicketStatusCategory; assigneeId?: string; priority?: TicketPriority };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/saved-views', { name, filters });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tickets.saveView.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('tickets.saveView.title')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t('tickets.saveView.name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('tickets.saveView.namePlaceholder')}
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewTicketModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<ServiceCatalogItem[] | null>(null);
  const [mode, setMode] = useState<'blank' | 'catalog'>('blank');

  useEffect(() => {
    apiGet<{ items: ServiceCatalogItem[] }>('/service-catalog-items').then((res) => {
      setItems(res.items);
      if (res.items.length > 0) setMode('catalog');
    });
  }, []);

  return (
    <Modal title={t('tickets.newTicketModal.title')} onClose={onClose}>
      {items === null ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : (
        <>
          {items.length > 0 && (
            <div className="mb-3 flex gap-1 rounded-[9px] bg-slate-100 p-[3px]">
              <button
                type="button"
                onClick={() => setMode('blank')}
                className={`flex-1 rounded-[7px] px-3 py-1.5 text-[13px] font-medium ${
                  mode === 'blank' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t('tickets.newTicketModal.blank')}
              </button>
              <button
                type="button"
                onClick={() => setMode('catalog')}
                className={`flex-1 rounded-[7px] px-3 py-1.5 text-[13px] font-medium ${
                  mode === 'catalog' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t('tickets.newTicketModal.fromCatalog')}
              </button>
            </div>
          )}
          {mode === 'blank' ? (
            <BlankTicketForm onClose={onClose} onCreated={(id) => navigate(`/tickets/${id}`)} />
          ) : (
            <CatalogRequestForm items={items} onClose={onClose} onCreated={(id) => navigate(`/tickets/${id}`)} />
          )}
        </>
      )}
    </Modal>
  );
}

// A ticket logged by hand -- a walk-in, a phone call -- when there's no
// Service Catalog item that fits. POST /tickets, agent-authenticated (see
// docs/adr/0026-work-section-improvements.md): before this, an agent with
// zero catalog items configured had no way to create a ticket at all from
// the console.
function BlankTicketForm({ onClose, onCreated }: { onClose: () => void; onCreated: (ticketId: string) => void }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ticket = await apiPost<{ id: string }>('/tickets', { subject, body, contactName, contactEmail, priority });
      onClose();
      onCreated(ticket.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tickets.form.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">{t('tickets.form.subject')}</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>

      <div className="flex gap-2">
        <label className="block flex-1 text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t('tickets.form.requesterName')}</span>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block flex-1 text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t('tickets.form.requesterEmail')}</span>
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
        <span className="mb-1 block font-medium text-slate-700">{t('tickets.form.description')}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          required
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">{t('tickets.form.priority')}</span>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TicketPriority)}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? t('common.creating') : t('tickets.form.createTicket')}
        </button>
      </div>
    </form>
  );
}

function CatalogRequestForm({
  items,
  onClose,
  onCreated,
}: {
  items: ServiceCatalogItem[];
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const { t } = useTranslation();
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [contactEmail, setContactEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [subject, setSubject] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<{ customFields: CustomFieldDefinition[] }>('/custom-fields').then((res) => setCustomFields(res.customFields));
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
      onCreated(ticket.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tickets.form.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">{t('tickets.form.request')}</span>
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
              <span className="mb-1 block font-medium text-slate-700">{t('tickets.form.requesterName')}</span>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block flex-1 text-sm">
              <span className="mb-1 block font-medium text-slate-700">{t('tickets.form.requesterEmail')}</span>
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
            <span className="mb-1 block font-medium text-slate-700">{t('tickets.form.subjectOptional')}</span>
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
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || !itemId}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? t('common.creating') : t('tickets.form.createTicket')}
            </button>
          </div>
    </form>
  );
}
