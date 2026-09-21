import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload, downloadFile, ApiError } from '../lib/api';
import type {
  AssetSummary,
  AutonomousLoopResult,
  CustomFieldDefinition,
  Macro,
  Problem,
  Team,
  Ticket,
  TicketAiUsage,
  TicketDetail as TicketDetailType,
  TicketPriority,
  TicketStatus,
  UserSummary,
} from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { ChannelGlyph } from '../components/ChannelGlyph';
import { BackArrowIcon, BoltIcon, ChevronDownIcon, ClockIcon, EyeIcon, LockIcon, PaperclipIcon, SparkleIcon } from '../components/icons';
import { PRIORITY_TONE, STATUS_CATEGORY_TONE, formatDateTime, isFirstResponseOverdue, isResolutionOverdue } from '../lib/format';
import { useTheme } from '../theme/ThemeContext';

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function TicketDetail() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<TicketDetailType | null>(null);
  const [statuses, setStatuses] = useState<TicketStatus[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [allAssets, setAllAssets] = useState<AssetSummary[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [assetToLink, setAssetToLink] = useState('');
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [applyingMacroId, setApplyingMacroId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presenceUserIds, setPresenceUserIds] = useState<string[]>([]);
  const [showMerge, setShowMerge] = useState(false);

  const [reply, setReply] = useState('');
  const [isPrivateNote, setIsPrivateNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState<TicketAiUsage | null>(null);
  const [usedArticles, setUsedArticles] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [autonomousRunning, setAutonomousRunning] = useState(false);
  const [autonomousResult, setAutonomousResult] = useState<AutonomousLoopResult | null>(null);

  function loadAiUsage() {
    if (!id) return;
    apiGet<TicketAiUsage>(`/tickets/${id}/ai-usage`)
      .then(setAiUsage)
      .catch(() => {});
  }

  useEffect(loadAiUsage, [id]);

  // Just the ticket itself -- called after every mutation (status/priority/
  // assignee change, macro run, asset link, a new message...). Reference data
  // below (statuses/teams/users/assets/custom fields/macros/problems) never
  // changes as a *result* of editing a ticket, so re-fetching all seven of
  // those on every single patch was pure waste; this is the fix.
  const loadTicket = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setTicket(await apiGet<TicketDetailType>(`/tickets/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ticketDetail.errors.loadFailed'));
    }
  }, [id]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [s, tm, u, a, cf, mc, pr] = await Promise.all([
        apiGet<{ statuses: TicketStatus[] }>('/ticket-statuses'),
        apiGet<{ teams: Team[] }>('/teams'),
        apiGet<{ users: UserSummary[] }>('/users'),
        // limit=200 (the max) -- this feeds the "link an asset" picker below,
        // which needs the whole list, not one page of it. A tenant with more
        // than 200 assets would need a real search-based picker here, same
        // limitation as the Problem-detail ticket picker (ADR 0026).
        apiGet<{ assets: AssetSummary[] }>('/assets?limit=200'),
        apiGet<{ customFields: CustomFieldDefinition[] }>('/custom-fields'),
        apiGet<{ macros: Macro[] }>('/macros'),
        apiGet<{ problems: Problem[] }>('/problems'),
      ]);
      setStatuses(s.statuses);
      setTeams(tm.teams);
      setUsers(u.users);
      setAllAssets(a.assets);
      setCustomFieldDefs(cf.customFields);
      setMacros(mc.macros);
      setProblems(pr.problems);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ticketDetail.errors.loadFailed'));
    }
  }, []);

  useEffect(() => {
    loadTicket();
    loadReferenceData();
  }, [loadTicket, loadReferenceData]);

  // Collision detection: "who else has this ticket open right now" -- a short-poll
  // heartbeat, not a WebSocket (see docs/adr/0019-collision-merge-bulk-actions.md).
  // Best-effort: a failed heartbeat just means the presence pill is a beat stale,
  // never worth surfacing as a page error.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function tick() {
      try {
        await apiPost(`/tickets/${id}/presence`);
        const res = await apiGet<{ userIds: string[] }>(`/tickets/${id}/presence`);
        if (!cancelled) setPresenceUserIds(res.userIds);
      } catch {
        // best-effort, see comment above
      }
    }
    tick();
    const interval = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  async function patch(data: Record<string, unknown>) {
    if (!id) return;
    try {
      await apiPatch(`/tickets/${id}`, data);
      await loadTicket();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ticketDetail.errors.updateFailed'));
    }
  }

  async function linkAsset() {
    if (!id || !assetToLink) return;
    try {
      await apiPost(`/tickets/${id}/assets`, { assetId: assetToLink });
      setAssetToLink('');
      await loadTicket();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ticketDetail.errors.linkAssetFailed'));
    }
  }

  async function unlinkAsset(assetId: string) {
    if (!id) return;
    try {
      await apiDelete(`/tickets/${id}/assets/${assetId}`);
      await loadTicket();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ticketDetail.errors.unlinkAssetFailed'));
    }
  }

  async function acknowledgeEscalation() {
    if (!id) return;
    try {
      await apiPost(`/tickets/${id}/escalation/acknowledge`);
      await loadTicket();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ticketDetail.errors.acknowledgeFailed'));
    }
  }

  async function sendReply() {
    if (!id || !reply.trim()) return;
    setSending(true);
    try {
      const message = await apiPost<{ id: string }>(`/tickets/${id}/messages`, { body: reply, isPrivateNote });
      for (const file of pendingFiles) {
        const form = new FormData();
        form.append('file', file);
        await apiUpload(`/messages/${message.id}/attachments`, form);
      }
      setReply('');
      setPendingFiles([]);
      setUsedArticles([]);
      await loadTicket();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ticketDetail.errors.sendMessageFailed'));
    } finally {
      setSending(false);
    }
  }

  function addPendingFiles(files: FileList | null) {
    if (!files) return;
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleSummarize() {
    if (!id) return;
    setAiError(null);
    setSummarizing(true);
    try {
      const res = await apiPost<{ summary: string }>(`/tickets/${id}/ai/summarize`);
      setSummary(res.summary);
      loadAiUsage();
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : t('ticketDetail.errors.summarizeFailed'));
    } finally {
      setSummarizing(false);
    }
  }

  async function handleSuggestReply() {
    if (!id) return;
    setAiError(null);
    setSuggesting(true);
    try {
      const res = await apiPost<{ suggestion: string; usedArticles: { id: string; title: string; slug: string }[] }>(
        `/tickets/${id}/ai/suggest-reply`,
      );
      setReply(res.suggestion);
      setUsedArticles(res.usedArticles ?? []);
      loadAiUsage();
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : t('ticketDetail.errors.suggestFailed'));
    } finally {
      setSuggesting(false);
    }
  }

  async function handleAutonomousRun() {
    if (!id) return;
    setAiError(null);
    setAutonomousRunning(true);
    try {
      const res = await apiPost<AutonomousLoopResult>(`/tickets/${id}/ai/autonomous-run`);
      setAutonomousResult(res);
      loadAiUsage();
      await loadTicket();
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : t('ticketDetail.errors.autonomousFailed'));
    } finally {
      setAutonomousRunning(false);
    }
  }

  async function handleApplyMacro(macroId: string) {
    if (!id || !macroId) return;
    setApplyingMacroId(macroId);
    setError(null);
    try {
      await apiPost(`/tickets/${id}/apply-macro`, { macroId });
      await loadTicket();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ticketDetail.errors.applyMacroFailed'));
    } finally {
      setApplyingMacroId(null);
    }
  }

  if (error && !ticket) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!ticket) return <div className="p-6 text-sm text-slate-500">{t('common.loading')}</div>;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto px-9 py-7">
        <Link to="/tickets" className="mb-3.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-600">
          <BackArrowIcon width={15} height={15} />
          {t('ticketDetail.backToTickets')}
        </Link>

        <div className="mb-5">
          <span className="text-[13px] font-medium text-slate-400">#{ticket.number}</span>
          <h1 className="mb-2.5 mt-0.5 text-[22px] font-extrabold tracking-tight text-slate-900">{ticket.subject}</h1>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_CATEGORY_TONE[ticket.status.category]} dot>
              {ticket.status.label}
            </Badge>
            <Badge tone={PRIORITY_TONE[ticket.priority]} dot>
              {t('ticketDetail.priorityLabel', { priority: ticket.priority })}
            </Badge>
            <span className="flex items-center gap-1.5">
              {theme !== 'refined' && <ChannelGlyph channel={ticket.channel} />}
              <Badge tone={ticket.channel === 'alert' ? 'rose' : 'slate'}>{ticket.channel}</Badge>
            </span>
            {ticket.externalId && <span className="text-xs text-slate-400">{t('ticketDetail.ref', { id: ticket.externalId })}</span>}
            {isFirstResponseOverdue(ticket) && (
              <Badge tone="rose">
                <ClockIcon width={11} height={11} />
                {t('ticketDetail.firstResponseOverdue')}
              </Badge>
            )}
            {isResolutionOverdue(ticket) && (
              <Badge tone="rose">
                <ClockIcon width={11} height={11} />
                {t('ticketDetail.resolutionOverdue')}
              </Badge>
            )}

            <div className="ml-auto flex items-center gap-2">
              {presenceUserIds.length > 0 && (
                <div className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  <EyeIcon width={12} height={12} />
                  {t('ticketDetail.alsoViewing', {
                    names: presenceUserIds.map((uid) => users.find((u) => u.id === uid)?.name ?? 'Someone').join(', '),
                  })}
                </div>
              )}
              {!ticket.mergedIntoId && (
                <button
                  onClick={() => setShowMerge(true)}
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                >
                  {t('ticketDetail.mergeInto')}
                </button>
              )}
              {macros.length > 0 && (
                <div className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1">
                  <BoltIcon width={12} height={12} className="text-slate-400" />
                  <select
                    value=""
                    disabled={applyingMacroId !== null}
                    onChange={(e) => handleApplyMacro(e.target.value)}
                    className="rounded bg-transparent text-xs font-semibold text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  >
                    <option value="" disabled>
                      {applyingMacroId ? t('tickets.bulk.applying') : t('ticketDetail.runMacro')}
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
                {summarizing ? t('ticketDetail.summarizing') : t('ticketDetail.summarize')}
              </button>
              <button
                onClick={handleAutonomousRun}
                disabled={autonomousRunning}
                title={t('ticketDetail.autonomousRunTooltip')}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                <SparkleIcon width={12} height={12} />
                {autonomousRunning ? t('ticketDetail.autonomousRunning') : t('ticketDetail.letAiTry')}
              </button>
              {aiUsage && aiUsage.totalCalls > 0 && (
                <span
                  title={t('ticketDetail.aiCallsTooltip', { count: aiUsage.totalCalls })}
                  className="text-[11px] text-slate-400"
                >
                  {t('ticketDetail.aiCost', { cost: aiUsage.totalCostUsd.toFixed(4) })}
                </span>
              )}
            </div>
          </div>
        </div>

        {ticket.mergedInto && (
          <div className="mb-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-[13.5px] text-orange-800">
            {t('ticketDetail.mergedIntoNotice')}{' '}
            <Link to={`/tickets/${ticket.mergedInto.id}`} className="font-semibold underline">
              #{ticket.mergedInto.number} {ticket.mergedInto.subject}
            </Link>
            .
          </div>
        )}
        {ticket.mergedTickets && ticket.mergedTickets.length > 0 && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13.5px] text-slate-600">
            {t('ticketDetail.mergedFromNotice')}{' '}
            {ticket.mergedTickets.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                <Link to={`/tickets/${t.id}`} className="font-medium text-indigo-700 hover:underline">
                  #{t.number} {t.subject}
                </Link>
              </span>
            ))}
          </div>
        )}

        {ticket.escalation && ticket.escalation.status !== 'ACKNOWLEDGED' && (
          <div
            className={`mb-3 flex items-center justify-between rounded-xl border px-4 py-2.5 text-[13.5px] ${
              ticket.escalation.status === 'EXHAUSTED'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            <span>
              {ticket.escalation.status === 'EXHAUSTED'
                ? t('ticketDetail.escalationExhausted', { tier: ticket.escalation.currentTierIndex + 1 })
                : t('ticketDetail.escalationActive', { tier: ticket.escalation.currentTierIndex + 1 })}
            </span>
            {ticket.escalation.status === 'ACTIVE' && (
              <button
                onClick={acknowledgeEscalation}
                className="flex-shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
              >
                {t('ticketDetail.acknowledge')}
              </button>
            )}
          </div>
        )}
        {ticket.escalation?.status === 'ACKNOWLEDGED' && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13.5px] text-emerald-800">
            {ticket.escalation.acknowledgedAt
              ? t('ticketDetail.escalationAcknowledgedAt', {
                  name: ticket.escalation.acknowledgedByUser?.name ?? 'someone',
                  time: formatDateTime(ticket.escalation.acknowledgedAt),
                })
              : t('ticketDetail.escalationAcknowledged', { name: ticket.escalation.acknowledgedByUser?.name ?? 'someone' })}
          </div>
        )}

        {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
        {aiError && <p className="mb-2 text-sm text-rose-600">{aiError}</p>}

        {summary && (
          <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-indigo-700">
              <SparkleIcon width={12} height={12} />
              {t('ticketDetail.aiSummaryTitle')}
            </div>
            <p className="text-[13.5px] leading-relaxed text-indigo-900">{summary}</p>
          </div>
        )}

        {autonomousResult && (
          <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-indigo-700">
              <SparkleIcon width={12} height={12} />
              {t('ticketDetail.autonomousRunTitle')}
              {autonomousResult.stoppedReason === 'max_iterations' && (
                <span className="font-normal text-indigo-400">{t('ticketDetail.autonomousStoppedEarly')}</span>
              )}
            </div>
            <p className="mb-1.5 text-[13.5px] leading-relaxed text-indigo-900">{autonomousResult.summary}</p>
            {autonomousResult.steps.length > 0 && (
              <p className="text-[12px] text-indigo-600">
                {autonomousResult.steps.flatMap((s) => s.toolCalls).map((tc) => tc.name).join(', ')} —{' '}
                <Link to="/ai-agent-activity" className="underline">
                  {t('ticketDetail.autonomousSeeDetails')}
                </Link>
              </p>
            )}
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
                        {t('ticketDetail.internal')}
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
                {message.attachments.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {message.attachments.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => downloadFile(`/attachments/${a.id}`)}
                        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <PaperclipIcon width={11} height={11} className="text-slate-400" />
                        {a.filename}
                        <span className="text-slate-400">{formatFileSize(a.sizeBytes)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-1.5 pb-2.5 shadow-sm">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t('ticketDetail.replyPlaceholder')}
            rows={3}
            className="w-full resize-none rounded-lg border-0 px-2.5 py-2 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          {usedArticles.length > 0 && (
            <p className="mb-1.5 px-1.5 text-[12px] text-slate-400">
              {t('ticketDetail.basedOn')}{' '}
              {usedArticles.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ', '}
                  <span className="font-medium text-slate-500">{a.title}</span>
                </span>
              ))}
            </p>
          )}
          {pendingFiles.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5 px-1.5">
              {pendingFiles.map((f, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-medium text-slate-600"
                >
                  <PaperclipIcon width={11} height={11} className="text-slate-400" />
                  {f.name}
                  <button onClick={() => removePendingFile(i)} className="text-slate-400 hover:text-rose-600">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
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
                {t('ticketDetail.internalNote')}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-[12.5px] font-medium text-slate-500 hover:bg-slate-50">
                <PaperclipIcon width={12} height={12} />
                {t('ticketDetail.attach')}
                <input type="file" multiple onChange={(e) => addPendingFiles(e.target.files)} className="hidden" />
              </label>
              <button
                onClick={handleSuggestReply}
                disabled={suggesting}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-[12.5px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                <SparkleIcon width={12} height={12} />
                {suggesting ? t('ticketDetail.drafting') : t('ticketDetail.suggestReply')}
              </button>
            </div>
            <button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {sending ? t('ticketDetail.sending') : isPrivateNote ? t('ticketDetail.addNote') : t('ticketDetail.sendReply')}
            </button>
          </div>
        </div>
      </div>

      <aside className="w-[280px] flex-shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-5 py-[22px]">
        <h2 className="mb-4 text-[13px] font-bold uppercase tracking-wide text-slate-400">{t('ticketDetail.detailsHeading')}</h2>

        <div className="flex flex-col gap-3.5">
          <PropertyRow label={t('ticketDetail.fields.status')}>
            <PropertySelect value={ticket.statusId} onChange={(v) => patch({ statusId: v })}>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </PropertySelect>
          </PropertyRow>

          <PropertyRow label={t('ticketDetail.fields.priority')}>
            <PropertySelect value={ticket.priority} onChange={(v) => patch({ priority: v })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </PropertySelect>
          </PropertyRow>

          <PropertyRow label={t('ticketDetail.fields.team')}>
            <PropertySelect value={ticket.teamId ?? ''} onChange={(v) => patch({ teamId: v || null })}>
              <option value="">{t('common.unassigned')}</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </PropertySelect>
          </PropertyRow>

          <PropertyRow label={t('ticketDetail.fields.assignee')}>
            <PropertySelect value={ticket.assigneeId ?? ''} onChange={(v) => patch({ assigneeId: v || null })}>
              <option value="">{t('common.unassigned')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </PropertySelect>
          </PropertyRow>

          <PropertyRow label={t('ticketDetail.fields.problem')}>
            <PropertySelect value={ticket.problemId ?? ''} onChange={(v) => patch({ problemId: v || null })}>
              <option value="">{t('ticketDetail.unlinkedProblem')}</option>
              {problems.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.number} {p.title}
                </option>
              ))}
            </PropertySelect>
          </PropertyRow>
        </div>

        {ticket.problem && (
          <Link
            to={`/problems/${ticket.problem.id}`}
            className="mt-2 block text-[12.5px] font-medium text-indigo-700 hover:underline"
          >
            {t('ticketDetail.viewProblem', { number: ticket.problem.number })}
          </Link>
        )}

        {(ticket.firstResponseDueAt || ticket.resolutionDueAt) && (
          <>
            <div className="my-[18px] h-px bg-slate-100" />
            <div className="flex flex-col gap-3.5">
              {ticket.firstResponseDueAt && (
                <PropertyRow label={t('ticketDetail.firstResponseLabel')}>
                  {ticket.firstRespondedAt ? (
                    <span className="text-[13px] font-medium text-emerald-600">
                      {t('ticketDetail.met', { time: formatDateTime(ticket.firstRespondedAt) })}
                    </span>
                  ) : (
                    <span className={`text-[13px] font-medium ${isFirstResponseOverdue(ticket) ? 'text-rose-600' : 'text-slate-700'}`}>
                      {t('ticketDetail.due', { time: formatDateTime(ticket.firstResponseDueAt) })}
                    </span>
                  )}
                </PropertyRow>
              )}
              {ticket.resolutionDueAt && (
                <PropertyRow label={t('ticketDetail.resolutionLabel')}>
                  {ticket.resolvedAt ? (
                    <span className="text-[13px] font-medium text-emerald-600">
                      {t('ticketDetail.met', { time: formatDateTime(ticket.resolvedAt) })}
                    </span>
                  ) : (
                    <span className={`text-[13px] font-medium ${isResolutionOverdue(ticket) ? 'text-rose-600' : 'text-slate-700'}`}>
                      {t('ticketDetail.due', { time: formatDateTime(ticket.resolutionDueAt) })}
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

        <FieldGroup label={t('ticketDetail.contact')}>
          <div className="flex items-center gap-2.5">
            <Avatar name={ticket.contact.name} size={30} />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-slate-800">{ticket.contact.name}</p>
              <p className="truncate text-xs text-slate-400">{ticket.contact.email}</p>
            </div>
          </div>
        </FieldGroup>

        <div className="my-[18px] h-px bg-slate-100" />

        <FieldGroup label={t('ticketDetail.linkedAssets')}>
          {ticket.assets.length === 0 && <p className="mb-2 text-[13px] text-slate-400">{t('ticketDetail.noneLinked')}</p>}
          {ticket.assets.map(({ asset }) => (
            <div key={asset.id} className="mb-1 rounded-lg bg-slate-50 px-2.5 py-1.5">
              <div className="flex items-center justify-between">
                <span className="truncate text-[13px] text-slate-700">
                  {asset.name}
                  {asset.ipAddress && <span className="text-slate-400"> · {asset.ipAddress}</span>}
                </span>
                <button onClick={() => unlinkAsset(asset.id)} className="flex-shrink-0 text-xs text-slate-400 hover:text-rose-600">
                  {t('common.remove')}
                </button>
              </div>
              {asset.services && asset.services.length > 0 && (
                <div className="mt-0.5 text-[11.5px] text-orange-600">
                  {t('ticketDetail.affects', { services: asset.services.map((s) => s.name).join(', ') })}
                </div>
              )}
            </div>
          ))}
          <div className="mt-2 flex gap-1.5">
            <select
              value={assetToLink}
              onChange={(e) => setAssetToLink(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12.5px] text-slate-700"
            >
              <option value="">{t('ticketDetail.linkAssetPlaceholder')}</option>
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
              {t('common.link')}
            </button>
          </div>
        </FieldGroup>
      </aside>

      {showMerge && ticket && (
        <MergeModal currentTicket={ticket} onClose={() => setShowMerge(false)} onMerged={loadTicket} />
      )}
    </div>
  );
}

function MergeModal({
  currentTicket,
  onClose,
  onMerged,
}: {
  currentTicket: TicketDetailType;
  onClose: () => void;
  onMerged: () => void;
}) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<Ticket[]>([]);
  const [intoTicketId, setIntoTicketId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<{ tickets: Ticket[] }>('/tickets')
      .then((res) => setCandidates(res.tickets.filter((tk) => tk.id !== currentTicket.id && !tk.mergedIntoId)))
      .catch(() => {});
  }, [currentTicket.id]);

  async function onSubmit() {
    if (!intoTicketId) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiPost(`/tickets/${currentTicket.id}/merge`, { intoTicketId });
      onMerged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ticketDetail.mergeModal.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('ticketDetail.mergeModal.title')} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-500">
          {t('ticketDetail.mergeModal.description', { number: currentTicket.number })}
        </p>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t('ticketDetail.mergeModal.mergeIntoLabel')}</span>
          <select
            value={intoTicketId}
            onChange={(e) => setIntoTicketId(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">{t('ticketDetail.mergeModal.chooseTicket')}</option>
            {candidates.map((tk) => (
              <option key={tk.id} value={tk.id}>
                #{tk.number} {tk.subject}
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
            onClick={onSubmit}
            disabled={submitting || !intoTicketId}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? t('ticketDetail.mergeModal.merging') : t('ticketDetail.mergeModal.merge')}
          </button>
        </div>
      </div>
    </Modal>
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
