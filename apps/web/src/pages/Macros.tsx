import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { TFunction } from 'i18next';
import type { Macro, Team, TicketPriority, TicketStatus, UserSummary } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';
import { Card } from '../components/Card';

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

function describeActions(t: TFunction, macro: Macro, statuses: TicketStatus[], teams: Team[], users: UserSummary[]): string[] {
  const parts: string[] = [];
  const { actions } = macro;
  const unassigned = t('macros.unassigned');
  if (actions.setStatusId) parts.push(t('macros.desc.status', { value: statuses.find((s) => s.id === actions.setStatusId)?.label ?? '?' }));
  if (actions.setPriority) parts.push(t('macros.desc.priority', { value: t(`priority.${actions.setPriority}`) }));
  if (actions.setTeamId !== undefined) parts.push(t('macros.desc.team', { value: teams.find((tm) => tm.id === actions.setTeamId)?.name ?? unassigned }));
  if (actions.setAssigneeId !== undefined) parts.push(t('macros.desc.assignee', { value: users.find((u) => u.id === actions.setAssigneeId)?.name ?? unassigned }));
  if (actions.addReply) parts.push(actions.addReply.isPrivateNote ? t('macros.desc.note') : t('macros.desc.reply'));
  return parts;
}

export function Macros() {
  const { t } = useTranslation();
  const [macros, setMacros] = useState<Macro[] | null>(null);
  const [statuses, setStatuses] = useState<TicketStatus[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Macro | null>(null);

  function load() {
    Promise.all([
      apiGet<{ macros: Macro[] }>('/macros'),
      apiGet<{ statuses: TicketStatus[] }>('/ticket-statuses'),
      apiGet<{ teams: Team[] }>('/teams'),
      apiGet<{ users: UserSummary[] }>('/users'),
    ])
      .then(([m, s, tm, u]) => {
        setMacros(m.macros);
        setStatuses(s.statuses);
        setTeams(tm.teams);
        setUsers(u.users);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('macros.loadFailed')));
  }

  useEffect(load, []);

  async function remove(macro: Macro) {
    if (!confirm(t('macros.confirmDelete', { name: macro.name }))) return;
    try {
      await apiDelete(`/macros/${macro.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('macros.deleteFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('macros.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('macros.new')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('macros.intro')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {macros === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {macros?.length === 0 && <p className="text-sm text-slate-500">{t('macros.empty')}</p>}

      {macros && macros.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {macros.map((m) => (
            <Card key={m.id} className="flex items-center justify-between">
              <div>
                <div className="mb-1 text-[14px] font-semibold text-slate-800">{m.name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {describeActions(t, m, statuses, teams, users).map((desc) => (
                    <Badge key={desc} tone="slate">
                      {desc}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                <button onClick={() => setEditing(m)} className="text-xs text-slate-400 hover:text-indigo-600">
                  {t('macros.edit')}
                </button>
                <button onClick={() => remove(m)} className="text-xs text-slate-400 hover:text-rose-600">
                  {t('macros.delete')}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <MacroModal statuses={statuses} teams={teams} users={users} onClose={() => setShowCreate(false)} onSaved={load} />
      )}
      {editing && (
        <MacroModal
          macro={editing}
          statuses={statuses}
          teams={teams}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function MacroModal({
  macro,
  statuses,
  teams,
  users,
  onClose,
  onSaved,
}: {
  macro?: Macro;
  statuses: TicketStatus[];
  teams: Team[];
  users: UserSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const a = macro?.actions;
  const [name, setName] = useState(macro?.name ?? '');
  const [enableStatus, setEnableStatus] = useState(a?.setStatusId !== undefined);
  const [statusId, setStatusId] = useState(a?.setStatusId ?? statuses[0]?.id ?? '');
  const [enablePriority, setEnablePriority] = useState(a?.setPriority !== undefined);
  const [priority, setPriority] = useState<TicketPriority>(a?.setPriority ?? 'NORMAL');
  const [enableTeam, setEnableTeam] = useState(a?.setTeamId !== undefined);
  const [teamId, setTeamId] = useState(a?.setTeamId ?? '');
  const [enableAssignee, setEnableAssignee] = useState(a?.setAssigneeId !== undefined);
  const [assigneeId, setAssigneeId] = useState(a?.setAssigneeId ?? '');
  const [enableReply, setEnableReply] = useState(!!a?.addReply);
  const [replyBody, setReplyBody] = useState(a?.addReply?.body ?? '');
  const [replyIsPrivate, setReplyIsPrivate] = useState(a?.addReply?.isPrivateNote ?? false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = {
        name,
        actions: {
          setStatusId: enableStatus ? statusId : undefined,
          setPriority: enablePriority ? priority : undefined,
          setTeamId: enableTeam ? teamId || null : undefined,
          setAssigneeId: enableAssignee ? assigneeId || null : undefined,
          addReply: enableReply ? { body: replyBody, isPrivateNote: replyIsPrivate } : undefined,
        },
      };
      if (macro) {
        await apiPatch(`/macros/${macro.id}`, data);
      } else {
        await apiPost('/macros', data);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('macros.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const noActionsSelected = !enableStatus && !enablePriority && !enableTeam && !enableAssignee && !enableReply;

  return (
    <Modal title={macro ? t('macros.editTitle', { name: macro.name }) : t('macros.new')} onClose={onClose}>
      <form onSubmit={onSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <Input label={t('macros.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('macros.namePlaceholder')} required />

        <div className="space-y-2 border-t border-slate-200 pt-2">
          <ActionRow label={t('macros.setStatus')} enabled={enableStatus} onToggle={setEnableStatus}>
            <Select hideLabel aria-label={t('macros.setStatus')} value={statusId} onChange={(e) => setStatusId(e.target.value)}>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </ActionRow>

          <ActionRow label={t('macros.setPriority')} enabled={enablePriority} onToggle={setEnablePriority}>
            <Select hideLabel aria-label={t('macros.setPriority')} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </Select>
          </ActionRow>

          <ActionRow label={t('macros.setTeam')} enabled={enableTeam} onToggle={setEnableTeam}>
            <Select hideLabel aria-label={t('macros.setTeam')} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">{t('macros.unassignedOption')}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </Select>
          </ActionRow>

          <ActionRow label={t('macros.setAssignee')} enabled={enableAssignee} onToggle={setEnableAssignee}>
            <Select hideLabel aria-label={t('macros.setAssignee')} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">{t('macros.unassignedOption')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </ActionRow>

          <ActionRow label={t('macros.addReply')} enabled={enableReply} onToggle={setEnableReply}>
            <div className="flex-1 space-y-1.5">
              <Textarea
                hideLabel
                aria-label={t('macros.replyText')}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder={t('macros.replyText')}
                rows={2}
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={replyIsPrivate}
                  onChange={(e) => setReplyIsPrivate(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
                />
                {t('macros.internalNote')}
              </label>
            </div>
          </ActionRow>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting} disabled={noActionsSelected}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
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
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
        />
        {label}
      </label>
      {enabled && <div className="flex-1">{children}</div>}
    </div>
  );
}
