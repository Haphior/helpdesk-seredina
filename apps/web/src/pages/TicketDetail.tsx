import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Team, TicketDetail as TicketDetailType, TicketPriority, TicketStatus, UserSummary } from '../lib/types';
import { Badge } from '../components/Badge';
import { PRIORITY_TONE, STATUS_CATEGORY_TONE, formatDateTime } from '../lib/format';

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<TicketDetailType | null>(null);
  const [statuses, setStatuses] = useState<TicketStatus[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [reply, setReply] = useState('');
  const [isPrivateNote, setIsPrivateNote] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [t, s, tm, u] = await Promise.all([
        apiGet<TicketDetailType>(`/tickets/${id}`),
        apiGet<{ statuses: TicketStatus[] }>('/ticket-statuses'),
        apiGet<{ teams: Team[] }>('/teams'),
        apiGet<{ users: UserSummary[] }>('/users'),
      ]);
      setTicket(t);
      setStatuses(s.statuses);
      setTeams(tm.teams);
      setUsers(u.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load ticket');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(data: Record<string, unknown>) {
    if (!id) return;
    try {
      await apiPatch(`/tickets/${id}`, data);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function sendReply() {
    if (!id || !reply.trim()) return;
    setSending(true);
    try {
      await apiPost(`/tickets/${id}/messages`, { body: reply, isPrivateNote });
      setReply('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  if (error && !ticket) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!ticket) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4">
          <span className="text-sm text-slate-500">#{ticket.number}</span>
          <h1 className="text-2xl font-semibold text-slate-900">{ticket.subject}</h1>
          <div className="mt-1 flex gap-2">
            <Badge tone={STATUS_CATEGORY_TONE[ticket.status.category]}>{ticket.status.label}</Badge>
            <Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge>
          </div>
        </div>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        <div className="space-y-3" data-testid="message-list">
          {ticket.messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-lg border p-3 text-sm ${
                message.isPrivateNote ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span className="font-medium text-slate-700">
                  {message.authorType === 'CONTACT' ? ticket.contact.name : message.authorUser?.name ?? message.authorType}
                  {message.isPrivateNote && ' · internal note'}
                </span>
                <span>{formatDateTime(message.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-slate-800">{message.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply…"
            rows={3}
            className="w-full resize-none border-0 text-sm focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={isPrivateNote} onChange={(e) => setIsPrivateNote(e.target.checked)} />
              Internal note
            </label>
            <button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {sending ? 'Sending…' : isPrivateNote ? 'Add note' : 'Send reply'}
            </button>
          </div>
        </div>
      </div>

      <aside className="w-64 border-l border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-3 font-medium text-slate-700">Details</h2>

        <FieldGroup label="Status">
          <select
            value={ticket.statusId}
            onChange={(e) => patch({ statusId: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </FieldGroup>

        <FieldGroup label="Priority">
          <select
            value={ticket.priority}
            onChange={(e) => patch({ priority: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </FieldGroup>

        <FieldGroup label="Team">
          <select
            value={ticket.teamId ?? ''}
            onChange={(e) => patch({ teamId: e.target.value || null })}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Unassigned</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FieldGroup>

        <FieldGroup label="Assignee">
          <select
            value={ticket.assigneeId ?? ''}
            onChange={(e) => patch({ assigneeId: e.target.value || null })}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </FieldGroup>

        <FieldGroup label="Contact">
          <p className="text-slate-700">{ticket.contact.name}</p>
          <p className="text-slate-500">{ticket.contact.email}</p>
        </FieldGroup>
      </aside>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <span className="mb-1 block text-xs font-medium uppercase text-slate-400">{label}</span>
      {children}
    </div>
  );
}
