import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import type { Ticket, TicketStatusCategory } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
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
  const [tab, setTab] = useState<TicketStatusCategory | 'ALL'>('ALL');
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Tickets</h1>
          {tickets && <span className="text-[13px] text-slate-400">{tickets.length} in this view</span>}
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
    </div>
  );
}
