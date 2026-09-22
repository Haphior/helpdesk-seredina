import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../lib/format';
import { formatDuration, milestoneState, nextSla, useNow, type SlaLevel, type SlaMilestone, type SlaState } from '../lib/sla';

const TEXT: Record<SlaLevel, string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  breached: 'text-rose-600',
};

const BAR: Record<SlaLevel, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  breached: 'bg-rose-500',
};

/**
 * Time left on one SLA milestone, colored by how much of its window is used
 * (docs/adr/0056-sla-countdown.md). `withBar` adds the progress bar used on
 * the ticket page; the queue shows the compact text only.
 */
export function SlaCountdown({ state, withBar = false }: { state: SlaState; withBar?: boolean }) {
  const { t } = useTranslation();
  const time = formatDuration(state.remainingMs);
  const label = state.level === 'breached' ? t('sla.overdueBy', { time }) : t('sla.left', { time });
  const title = t(`sla.${state.milestone}Due`, { time: formatDateTime(state.dueAt.toISOString()) });

  return (
    <span className="flex min-w-0 flex-col gap-1" title={title}>
      <span className={`whitespace-nowrap text-[12.5px] font-semibold tabular-nums ${TEXT[state.level]}`}>{label}</span>
      {withBar && (
        <span
          className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(state.usedFraction, 1) * 100)}
        >
          <span
            className={`block h-full rounded-full transition-[width] duration-700 ${BAR[state.level]}`}
            style={{ width: `${Math.min(Math.max(state.usedFraction, 0), 1) * 100}%` }}
          />
        </span>
      )}
    </span>
  );
}

/**
 * The queue's SLA cell: the next milestone to come due. Subscribes to the
 * shared clock itself, so each second only these cells re-render, not the
 * whole queue.
 */
export function TicketSlaCell({ ticket }: { ticket: Parameters<typeof nextSla>[0] }) {
  const { t } = useTranslation();
  const state = nextSla(ticket, useNow());
  if (!state) return <span className="text-[12.5px] text-slate-300">—</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <SlaCountdown state={state} />
      <span className="text-[11px] text-slate-400">{t(`sla.${state.milestone}Short`)}</span>
    </span>
  );
}

/**
 * One milestone on the ticket page: countdown with its progress bar and the
 * exact due time, or null once it's met (the caller shows "Met …" then).
 * Own clock subscription, same reason as TicketSlaCell.
 */
export function SlaMilestoneCountdown({
  ticket,
  milestone,
}: {
  ticket: Parameters<typeof milestoneState>[0];
  milestone: SlaMilestone;
}) {
  const state = milestoneState(ticket, milestone, useNow());
  if (!state) return null;
  return (
    <span className="flex w-40 flex-col gap-0.5">
      <SlaCountdown state={state} withBar />
      <span className="text-[11px] text-slate-400">{formatDateTime(state.dueAt.toISOString())}</span>
    </span>
  );
}
