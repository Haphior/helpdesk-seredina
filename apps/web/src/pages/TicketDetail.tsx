import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type {
  AssetSummary,
  CustomFieldDefinition,
  Macro,
  Team,
  TicketDetail as TicketDetailType,
  TicketPriority,
  TicketStatus,
  UserSummary,
} from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { BackArrowIcon, BoltIcon, ChevronDownIcon, ClockIcon, LockIcon, SparkleIcon } from '../components/icons';
import { PRIORITY_TONE, STATUS_CATEGORY_TONE, formatDateTime, isFirstResponseOverdue, isResolutionOverdue } from '../lib/format';

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<TicketDetailType | null>(null);
  const [statuses, setStatuses] = useState<TicketStatus[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [allAssets, setAllAssets] = useState<AssetSummary[]>([]);
  const [assetToLink, setAssetToLink] = useState('');
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [applyingMacroId, setApplyingMacroId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reply, setReply] = useState('');
  const [isPrivateNote, setIsPrivateNote] = useState(false);
  const [sending, setSending] = useState(false);

  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [t, s, tm, u, a, cf, mc] = await Promise.all([
        apiGet<TicketDetailType>(`/tickets/${id}`),
        apiGet<{ statuses: TicketStatus[] }>('/ticket-statuses'),
        apiGet<{ teams: Team[] }>('/teams'),
        apiGet<{ users: UserSummary[] }>('/users'),
        apiGet<{ assets: AssetSummary[] }>('/assets'),
        apiGet<{ customFields: CustomFieldDefinition[] }>('/custom-fields'),
        apiGet<{ macros: Macro[] }>('/macros'),
      ]);
      setTicket(t);
      setStatuses(s.statuses);
      setTeams(tm.teams);
      setUsers(u.users);
      setAllAssets(a.assets);
      setCustomFieldDefs(cf.customFields);
      setMacros(mc.macros);
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

  async function linkAsset() {
    if (!id || !assetToLink) return;
    try {
      await apiPost(`/tickets/${id}/assets`, { assetId: assetToLink });
      setAssetToLink('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to link asset');
    }
  }

  async function unlinkAsset(assetId: string) {
    if (!id) return;
    try {
      await apiDelete(`/tickets/${id}/assets/${assetId}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to unlink asset');
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

  async function handleSummarize() {
    if (!id) return;
    setAiError(null);
    setSummarizing(true);
    try {
      const res = await apiPost<{ summary: string }>(`/tickets/${id}/ai/summarize`);
      setSummary(res.summary);
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : 'Failed to summarize');
    } finally {
      setSummarizing(false);
    }
  }

  async function handleSuggestReply() {
    if (!id) return;
    setAiError(null);
    setSuggesting(true);
    try {
      const res = await apiPost<{ suggestion: string }>(`/tickets/${id}/ai/suggest-reply`);
      setReply(res.suggestion);
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : 'Failed to suggest a reply');
    } finally {
      setSuggesting(false);
    }
  }

  async function handleApplyMacro(macroId: string) {
    if (!id || !macroId) return;
    setApplyingMacroId(macroId);
    setError(null);
    try {
      await apiPost(`/tickets/${id}/apply-macro`, { macroId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to apply macro');
    } finally {
      setApplyingMacroId(null);
    }
  }

  if (error && !ticket) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!ticket) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto px-9 py-7">
        <Link to="/tickets" className="mb-3.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-600">
          <BackArrowIcon width={15} height={15} />
          Tickets
        </Link>

        <div className="mb-5">
          <span className="text-[13px] font-medium text-slate-400">#{ticket.number}</span>
          <h1 className="mb-2.5 mt-0.5 text-[22px] font-extrabold tracking-tight text-slate-900">{ticket.subject}</h1>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_CATEGORY_TONE[ticket.status.category]} dot>
              {ticket.status.label}
            </Badge>
            <Badge tone={PRIORITY_TONE[ticket.priority]} dot>
              {ticket.priority} priority
            </Badge>
            <Badge tone={ticket.channel === 'alert' ? 'rose' : 'slate'}>{ticket.channel}</Badge>
            {ticket.externalId && <span className="text-xs text-slate-400">ref: {ticket.externalId}</span>}
            {isFirstResponseOverdue(ticket) && (
              <Badge tone="rose">
                <ClockIcon width={11} height={11} />
                First response overdue
              </Badge>
            )}
            {isResolutionOverdue(ticket) && (
              <Badge tone="rose">
                <ClockIcon width={11} height={11} />
                Resolution overdue
              </Badge>
            )}

            <div className="ml-auto flex items-center gap-2">
              {macros.length > 0 && (
                <div className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1">
                  <BoltIcon width={12} height={12} className="text-slate-400" />
                  <select
                    value=""
                    disabled={applyingMacroId !== null}
                    onChange={(e) => handleApplyMacro(e.target.value)}
                    className="bg-transparent text-xs font-semibold text-slate-500 focus:outline-none"
                  >
                    <option value="" disabled>
                      {applyingMacroId ? 'Applying…' : 'Run macro…'}
                    </option>
                    {macros.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                onClick={handleSummarize}
                disabled={summarizing}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                <SparkleIcon width={12} height={12} />
                {summarizing ? 'Summarizing…' : 'Summarize'}
              </button>
            </div>
          </div>
        </div>

        {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
        {aiError && <p className="mb-2 text-sm text-rose-600">{aiError}</p>}

        {summary && (
          <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-indigo-700">
              <SparkleIcon width={12} height={12} />
              AI summary
            </div>
            <p className="text-[13.5px] leading-relaxed text-indigo-900">{summary}</p>
          </div>
        )}

        <div className="flex flex-col gap-3" data-testid="message-list">
          {ticket.messages.map((message) => {
            const authorName = message.authorType === 'CONTACT' ? ticket.contact.name : message.authorUser?.name ?? message.authorType;
            return (
              <div
                key={message.id}
                className={`rounded-xl border p-3.5 shadow-sm ${
                  message.isPrivateNote ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar name={authorName} size={22} />
                    <span className="text-[13px] font-semibold text-slate-700">{authorName}</span>
                    {message.isPrivateNote && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                        <LockIcon width={10} height={10} />
                        Internal
                      </span>
                    )}
                  </div>
                  <span className={`text-xs ${message.isPrivateNote ? 'text-amber-600' : 'text-slate-400'}`}>
                    {formatDateTime(message.createdAt)}
                  </span>
                </div>
                <p className={`whitespace-pre-wrap text-[13.5px] leading-relaxed ${message.isPrivateNote ? 'text-amber-900' : 'text-slate-700'}`}>
                  {message.body}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-1.5 pb-2.5 shadow-sm">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply…"
            rows={3}
            className="w-full resize-none rounded-lg border-0 px-2.5 py-2 text-[13.5px] focus:outline-none"
          />
          <div className="flex items-center justify-between px-1.5">
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12.5px] font-medium text-slate-500">
                <input
                  type="checkbox"
                  checked={isPrivateNote}
                  onChange={(e) => setIsPrivateNote(e.target.checked)}
                  className="h-3 w-3 accent-amber-500"
                />
                <LockIcon width={12} height={12} />
                Internal note
              </label>
              <button
                onClick={handleSuggestReply}
                disabled={suggesting}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-[12.5px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                <SparkleIcon width={12} height={12} />
                {suggesting ? 'Drafting…' : 'Suggest reply'}
              </button>
            </div>
            <button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {sending ? 'Sending…' : isPrivateNote ? 'Add note' : 'Send reply'}
            </button>
          </div>
        </div>
      </div>

      <aside className="w-[280px] flex-shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-5 py-[22px]">
        <h2 className="mb-4 text-[13px] font-bold uppercase tracking-wide text-slate-400">Details</h2>

        <div className="flex flex-col gap-3.5">
          <PropertyRow label="Status">
            <PropertySelect value={ticket.statusId} onChange={(v) => patch({ statusId: v })}>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </PropertySelect>
          </PropertyRow>

          <PropertyRow label="Priority">
            <PropertySelect value={ticket.priority} onChange={(v) => patch({ priority: v })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </PropertySelect>
          </PropertyRow>

          <PropertyRow label="Team">
            <PropertySelect value={ticket.teamId ?? ''} onChange={(v) => patch({ teamId: v || null })}>
              <option value="">Unassigned</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </PropertySelect>
          </PropertyRow>

          <PropertyRow label="Assignee">
            <PropertySelect value={ticket.assigneeId ?? ''} onChange={(v) => patch({ assigneeId: v || null })}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </PropertySelect>
          </PropertyRow>
        </div>

        {(ticket.firstResponseDueAt || ticket.resolutionDueAt) && (
          <>
            <div className="my-[18px] h-px bg-slate-100" />
            <div className="flex flex-col gap-3.5">
              {ticket.firstResponseDueAt && (
                <PropertyRow label="First response">
                  {ticket.firstRespondedAt ? (
                    <span className="text-[13px] font-medium text-emerald-600">Met {formatDateTime(ticket.firstRespondedAt)}</span>
                  ) : (
                    <span className={`text-[13px] font-medium ${isFirstResponseOverdue(ticket) ? 'text-rose-600' : 'text-slate-700'}`}>
                      Due {formatDateTime(ticket.firstResponseDueAt)}
                    </span>
                  )}
                </PropertyRow>
              )}
              {ticket.resolutionDueAt && (
                <PropertyRow label="Resolution">
                  {ticket.resolvedAt ? (
                    <span className="text-[13px] font-medium text-emerald-600">Met {formatDateTime(ticket.resolvedAt)}</span>
                  ) : (
                    <span className={`text-[13px] font-medium ${isResolutionOverdue(ticket) ? 'text-rose-600' : 'text-slate-700'}`}>
                      Due {formatDateTime(ticket.resolutionDueAt)}
                    </span>
                  )}
                </PropertyRow>
              )}
            </div>
          </>
        )}

        {customFieldDefs.length > 0 && (
          <>
            <div className="my-[18px] h-px bg-slate-100" />
            <div className="flex flex-col gap-3.5">
              {customFieldDefs.map((def) => (
                <PropertyRow key={def.id} label={def.label}>
                  <CustomFieldControl
                    key={`${def.id}-${ticket.updatedAt}`}
                    def={def}
                    value={ticket.customFields?.[def.key]}
                    onChange={(value) => patch({ customFields: { [def.key]: value } })}
                  />
                </PropertyRow>
              ))}
            </div>
          </>
        )}

        <div className="my-[18px] h-px bg-slate-100" />

        <FieldGroup label="Contact">
          <div className="flex items-center gap-2.5">
            <Avatar name={ticket.contact.name} size={30} />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-slate-800">{ticket.contact.name}</p>
              <p className="truncate text-xs text-slate-400">{ticket.contact.email}</p>
            </div>
          </div>
        </FieldGroup>

        <div className="my-[18px] h-px bg-slate-100" />

        <FieldGroup label="Linked assets">
          {ticket.assets.length === 0 && <p className="mb-2 text-[13px] text-slate-400">None linked.</p>}
          {ticket.assets.map(({ asset }) => (
            <div key={asset.id} className="mb-1 flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5">
              <span className="truncate text-[13px] text-slate-700">
                {asset.name}
                {asset.ipAddress && <span className="text-slate-400"> · {asset.ipAddress}</span>}
              </span>
              <button onClick={() => unlinkAsset(asset.id)} className="flex-shrink-0 text-xs text-slate-400 hover:text-rose-600">
                remove
              </button>
            </div>
          ))}
          <div className="mt-2 flex gap-1.5">
            <select
              value={assetToLink}
              onChange={(e) => setAssetToLink(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12.5px] text-slate-700"
            >
              <option value="">Link an asset…</option>
              {allAssets
                .filter((a) => !ticket.assets.some((ta) => ta.assetId === a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
            <button
              onClick={linkAsset}
              disabled={!assetToLink}
              className="flex-shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              Link
            </button>
          </div>
        </FieldGroup>
      </aside>
    </div>
  );
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function CustomFieldControl({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const inputClass = 'w-32 rounded-lg bg-slate-50 px-2.5 py-1.5 text-right text-[13px] font-medium text-slate-700 hover:bg-slate-100';

  if (def.fieldType === 'BOOLEAN') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-indigo-600"
      />
    );
  }

  if (def.fieldType === 'SELECT') {
    return (
      <PropertySelect value={typeof value === 'string' ? value : ''} onChange={onChange}>
        <option value="">—</option>
        {def.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </PropertySelect>
    );
  }

  if (def.fieldType === 'NUMBER') {
    return (
      <input
        type="number"
        defaultValue={typeof value === 'number' ? value : ''}
        onBlur={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={inputClass}
      />
    );
  }

  if (def.fieldType === 'DATE') {
    return (
      <input
        type="date"
        defaultValue={typeof value === 'string' ? value : ''}
        onBlur={(e) => onChange(e.target.value || null)}
        className={inputClass}
      />
    );
  }

  return (
    <input
      type="text"
      defaultValue={typeof value === 'string' ? value : ''}
      onBlur={(e) => onChange(e.target.value || null)}
      className={inputClass}
    />
  );
}

function PropertySelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg bg-slate-50 py-1.5 pl-2.5 pr-7 text-[13px] font-medium text-slate-700 hover:bg-slate-100"
      >
        {children}
      </select>
      <ChevronDownIcon width={13} height={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </div>
  );
}
