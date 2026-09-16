import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { Macro, Team, TicketPriority, TicketStatus, UserSummary } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

function describeActions(macro: Macro, statuses: TicketStatus[], teams: Team[], users: UserSummary[]): string[] {
  const parts: string[] = [];
  const { actions } = macro;
  if (actions.setStatusId) parts.push(`status → ${statuses.find((s) => s.id === actions.setStatusId)?.label ?? '?'}`);
  if (actions.setPriority) parts.push(`priority → ${actions.setPriority}`);
  if (actions.setTeamId !== undefined) parts.push(`team → ${teams.find((t) => t.id === actions.setTeamId)?.name ?? 'unassigned'}`);
  if (actions.setAssigneeId !== undefined) parts.push(`assignee → ${users.find((u) => u.id === actions.setAssigneeId)?.name ?? 'unassigned'}`);
  if (actions.addReply) parts.push(actions.addReply.isPrivateNote ? 'add internal note' : 'send reply');
  return parts;
}

export function Macros() {
  const [macros, setMacros] = useState<Macro[] | null>(null);
  const [statuses, setStatuses] = useState<TicketStatus[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    Promise.all([
      apiGet<{ macros: Macro[] }>('/macros'),
      apiGet<{ statuses: TicketStatus[] }>('/ticket-statuses'),
      apiGet<{ teams: Team[] }>('/teams'),
      apiGet<{ users: UserSummary[] }>('/users'),
    ])
      .then(([m, s, t, u]) => {
        setMacros(m.macros);
        setStatuses(s.statuses);
        setTeams(t.teams);
        setUsers(u.users);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load macros'));
  }

  useEffect(load, []);

  async function remove(macro: Macro) {
    if (!confirm(`Delete macro "${macro.name}"?`)) return;
    try {
      await apiDelete(`/macros/${macro.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete macro');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Macros</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New macro
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        A saved bundle of actions applied to a ticket in one click — set fields, send a canned reply, or both.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {macros === null && <p className="text-sm text-slate-500">Loading…</p>}
      {macros?.length === 0 && <p className="text-sm text-slate-500">No macros yet.</p>}

      {macros && macros.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {macros.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <div className="mb-1 text-[14px] font-semibold text-slate-800">{m.name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {describeActions(m, statuses, teams, users).map((desc) => (
                    <Badge key={desc} tone="slate">
                      {desc}
                    </Badge>
                  ))}
                </div>
              </div>
              <button onClick={() => remove(m)} className="text-xs text-slate-400 hover:text-rose-600">
                delete
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateMacroModal statuses={statuses} teams={teams} users={users} onClose={() => setShowCreate(false)} onCreated={load} />
      )}
    </div>
  );
}

function CreateMacroModal({
  statuses,
  teams,
  users,
  onClose,
  onCreated,
}: {
  statuses: TicketStatus[];
  teams: Team[];
  users: UserSummary[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [enableStatus, setEnableStatus] = useState(false);
  const [statusId, setStatusId] = useState(statuses[0]?.id ?? '');
  const [enablePriority, setEnablePriority] = useState(false);
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [enableTeam, setEnableTeam] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [enableAssignee, setEnableAssignee] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [enableReply, setEnableReply] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replyIsPrivate, setReplyIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/macros', {
        name,
        actions: {
          setStatusId: enableStatus ? statusId : undefined,
          setPriority: enablePriority ? priority : undefined,
          setTeamId: enableTeam ? teamId || null : undefined,
          setAssigneeId: enableAssignee ? assigneeId || null : undefined,
          addReply: enableReply ? { body: replyBody, isPrivateNote: replyIsPrivate } : undefined,
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create macro');
    } finally {
      setSubmitting(false);
    }
  }

  const noActionsSelected = !enableStatus && !enablePriority && !enableTeam && !enableAssignee && !enableReply;

  return (
    <Modal title="New macro" onClose={onClose}>
      <form onSubmit={onSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Escalate to urgent"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <div className="space-y-2 border-t border-slate-200 pt-2">
          <ActionRow label="Set status" enabled={enableStatus} onToggle={setEnableStatus}>
            <select value={statusId} onChange={(e) => setStatusId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </ActionRow>

          <ActionRow label="Set priority" enabled={enablePriority} onToggle={setEnablePriority}>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </ActionRow>

          <ActionRow label="Set team" enabled={enableTeam} onToggle={setEnableTeam}>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
              <option value="">Unassigned</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </ActionRow>

          <ActionRow label="Set assignee" enabled={enableAssignee} onToggle={setEnableAssignee}>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </ActionRow>

          <ActionRow label="Add reply" enabled={enableReply} onToggle={setEnableReply}>
            <div className="flex-1 space-y-1.5">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Reply text"
                rows={2}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={replyIsPrivate} onChange={(e) => setReplyIsPrivate(e.target.checked)} />
                Internal note (not sent to customer)
              </label>
            </div>
          </ActionRow>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || noActionsSelected}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ActionRow({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-slate-200 p-2">
      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {label}
      </label>
      {enabled && <div className="flex-1">{children}</div>}
    </div>
  );
}
