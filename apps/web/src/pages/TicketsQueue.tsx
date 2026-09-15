import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import type { Ticket, TicketStatusCategory } from '../lib/types';
import { Badge } from '../components/Badge';
import { PRIORITY_TONE, STATUS_CATEGORY_TONE, formatDateTime } from '../lib/format';

const TABS: { key: TicketStatusCategory | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
];

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
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">Tickets</h1>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.key ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {tickets === null && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {tickets?.length === 0 && <p className="text-sm text-slate-500">No tickets here.</p>}

      {tickets && tickets.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Priority</th>
                <th className="px-4 py-2 font-medium">Assignee</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-500">#{ticket.number}</td>
                  <td className="px-4 py-2">
                    <Link to={`/tickets/${ticket.id}`} className="font-medium text-indigo-700 hover:underline">
                      {ticket.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={ticket.channel === 'alert' ? 'red' : 'slate'}>{ticket.channel}</Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{ticket.contact.name}</td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_CATEGORY_TONE[ticket.status.category]}>{ticket.status.label}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{ticket.assignee?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500">{formatDateTime(ticket.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
