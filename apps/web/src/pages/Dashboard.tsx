import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPut, ApiError } from '../lib/api';
import type {
  AgentWorkloadReport,
  CsatSummary,
  DashboardPref,
  OnboardingChecklist,
  SlaComplianceReport,
  Ticket,
  TicketVolumePoint,
  WidgetType,
} from '../lib/types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, EyeIcon, EyeOffIcon } from '../components/icons';
import { PRIORITY_TONE, STATUS_CATEGORY_TONE } from '../lib/format';

interface DashboardData {
  onboarding: OnboardingChecklist;
  volume: TicketVolumePoint[];
  priority: Record<string, number>;
  sla: SlaComplianceReport;
  csat: CsatSummary;
  workload: AgentWorkloadReport;
  recent: Ticket[];
}

export function Dashboard() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<DashboardPref[] | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    Promise.all([
      apiGet<{ widgets: DashboardPref[] }>('/dashboard-widgets'),
      apiGet<OnboardingChecklist>('/onboarding-checklist'),
      apiGet<{ volume: TicketVolumePoint[] }>('/reporting/ticket-volume?days=14'),
      apiGet<{ breakdown: Record<string, number> }>('/reporting/priority-breakdown'),
      apiGet<SlaComplianceReport>('/reporting/sla-compliance'),
      apiGet<CsatSummary>('/reporting/csat-summary'),
      apiGet<AgentWorkloadReport>('/reporting/agent-workload'),
      apiGet<{ tickets: Ticket[] }>('/reporting/recent-activity'),
    ])
      .then(([p, ob, v, pr, s, c, w, r]) => {
        setPrefs(p.widgets);
        setData({ onboarding: ob, volume: v.volume, priority: pr.breakdown, sla: s, csat: c, workload: w, recent: r.tickets });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('dashboard.loadFailed')));
  }

  useEffect(load, []);

  async function setVisible(widgetType: WidgetType, visible: boolean) {
    if (!prefs) return;
    setPrefs(prefs.map((p) => (p.widgetType === widgetType ? { ...p, visible } : p)));
    try {
      await apiPut('/dashboard-widgets', { widgetType, visible });
    } catch {
      load(); // revert to server truth on failure
    }
  }

  async function move(widgetType: WidgetType, direction: -1 | 1) {
    if (!prefs) return;
    const i = prefs.findIndex((p) => p.widgetType === widgetType);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= prefs.length) return;

    const a = prefs[i];
    const b = prefs[j];
    const next = [...prefs];
    next[i] = { ...a, sortOrder: b.sortOrder };
    next[j] = { ...b, sortOrder: a.sortOrder };
    next.sort((x, y) => x.sortOrder - y.sortOrder);
    setPrefs(next);

    try {
      await Promise.all([
        apiPut('/dashboard-widgets', { widgetType: a.widgetType, sortOrder: b.sortOrder }),
        apiPut('/dashboard-widgets', { widgetType: b.widgetType, sortOrder: a.sortOrder }),
      ]);
    } catch {
      load();
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('dashboard.title')}</h1>
      <p className="mb-5 text-[13.5px] text-slate-500">{t('dashboard.subtitle')}</p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {(!prefs || !data) && !error && <p className="text-sm text-slate-500">{t('dashboard.loading')}</p>}

      {prefs && data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {prefs.map((pref, i) => (
            <WidgetCard
              key={pref.widgetType}
              pref={pref}
              canMoveUp={i > 0}
              canMoveDown={i < prefs.length - 1}
              onToggle={() => setVisible(pref.widgetType, !pref.visible)}
              onMoveUp={() => move(pref.widgetType, -1)}
              onMoveDown={() => move(pref.widgetType, 1)}
            >
              {pref.visible && renderWidget(pref.widgetType, data)}
            </WidgetCard>
          ))}
        </div>
      )}
    </div>
  );
}

function WidgetCard({
  pref,
  canMoveUp,
  canMoveDown,
  onToggle,
  onMoveUp,
  onMoveDown,
  children,
}: {
  pref: DashboardPref;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const label = t(`dashboard.widgets.${pref.widgetType}`);
  return (
    <Card className={`group ${!pref.visible ? 'opacity-50' : ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13.5px] font-semibold text-slate-700">{label}</h2>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            aria-label={t('dashboard.moveUp', { widget: label })}
            onClick={onMoveUp}
            disabled={!canMoveUp}
          >
            <ChevronUpIcon width={13} height={13} />
          </Button>
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            aria-label={t('dashboard.moveDown', { widget: label })}
            onClick={onMoveDown}
            disabled={!canMoveDown}
          >
            <ChevronDownIcon width={13} height={13} />
          </Button>
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            aria-label={pref.visible ? t('dashboard.hide', { widget: label }) : t('dashboard.show', { widget: label })}
            onClick={onToggle}
          >
            {pref.visible ? <EyeIcon width={13} height={13} /> : <EyeOffIcon width={13} height={13} />}
          </Button>
        </div>
      </div>
      {pref.visible ? children : <p className="text-xs text-slate-400">{t('dashboard.hidden')}</p>}
    </Card>
  );
}

function renderWidget(type: WidgetType, data: DashboardData) {
  switch (type) {
    case 'onboarding_checklist':
      return <OnboardingChecklistWidget checklist={data.onboarding} />;
    case 'ticket_volume':
      return <TicketVolumeWidget points={data.volume} />;
    case 'priority_breakdown':
      return <PriorityBreakdownWidget counts={data.priority} />;
    case 'sla_compliance':
      return <SlaComplianceWidget report={data.sla} />;
    case 'csat_score':
      return <CsatScoreWidget summary={data.csat} />;
    case 'agent_workload':
      return <AgentWorkloadWidget report={data.workload} />;
    case 'recent_activity':
      return <RecentActivityWidget tickets={data.recent} />;
  }
}

function TicketVolumeWidget({ points }: { points: TicketVolumePoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const barW = 100 / points.length;
  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-24 w-full">
        {points.map((p, i) => {
          const h = (p.count / max) * 34;
          return (
            <rect
              key={p.date}
              x={i * barW + barW * 0.18}
              y={38 - h}
              width={barW * 0.64}
              height={Math.max(h, 1)}
              rx={0.6}
              fill="#6366f1"
            />
          );
        })}
      </svg>
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
        <span>{formatShortDate(points[0]?.date)}</span>
        <span>{formatShortDate(points[points.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

function formatShortDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The one-segment gauge shared by PriorityBreakdownWidget and
// AgentWorkloadWidget -- three near-identical inline copies of this same
// h-2/rounded-full/bg-slate-100 + colored fill markup existed before this
// pass; SlaComplianceWidget's two-segment bar below is a different enough
// shape (met/breached split, not a single value against a shared max) to
// stay its own thing rather than forcing a shared abstraction over both.
function ProgressBar({ value, max, colorClassName }: { value: number; max: number; colorClassName: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${colorClassName}`} style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}

const PRIORITY_ORDER = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

function PriorityBreakdownWidget({ counts }: { counts: Record<string, number> }) {
  const max = Math.max(1, ...PRIORITY_ORDER.map((p) => counts[p] ?? 0));
  return (
    <div className="flex flex-col gap-2">
      {PRIORITY_ORDER.map((p) => {
        const count = counts[p] ?? 0;
        return (
          <div key={p} className="flex items-center gap-2.5">
            <Badge tone={PRIORITY_TONE[p]} dot>
              {p}
            </Badge>
            <ProgressBar value={count} max={max} colorClassName="bg-indigo-400" />
            <span className="w-6 text-right text-[12.5px] font-medium text-slate-600">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function SlaComplianceWidget({ report }: { report: SlaComplianceReport }) {
  const { t } = useTranslation();
  if (report.total === 0) {
    return <p className="text-xs text-slate-400">{t('dashboard.sla.empty')}</p>;
  }
  const pct = report.percentMet ?? 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-slate-900">{pct}%</span>
        <span className="text-xs text-slate-400">{t('dashboard.sla.summary', { total: report.total })}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        <div className="h-full bg-rose-400" style={{ width: `${100 - pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
        <span>{t('dashboard.sla.met', { count: report.met })}</span>
        <span>{t('dashboard.sla.breached', { count: report.breached })}</span>
      </div>
    </div>
  );
}

function CsatScoreWidget({ summary }: { summary: CsatSummary }) {
  const { t } = useTranslation();
  if (summary.total === 0) {
    return <p className="text-xs text-slate-400">{t('dashboard.csat.empty')}</p>;
  }
  const max = Math.max(1, ...Object.values(summary.distribution));
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-slate-900">{summary.average}</span>
        <span className="text-xs text-slate-400">{t('dashboard.csat.summary', { total: summary.total })}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {[5, 4, 3, 2, 1].map((star) => (
          <div key={star} className="flex items-center gap-2.5">
            <span className="w-6 text-right text-[12px] text-slate-500">{star}★</span>
            <ProgressBar value={summary.distribution[star] ?? 0} max={max} colorClassName="bg-amber-400" />
            <span className="w-5 text-[12px] text-slate-400">{summary.distribution[star] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentWorkloadWidget({ report }: { report: AgentWorkloadReport }) {
  const { t } = useTranslation();
  const max = Math.max(1, report.unassigned, ...report.agents.map((a) => a.count));
  return (
    <div className="flex flex-col gap-2">
      {report.agents.map((a) => (
        <div key={a.userId} className="flex items-center gap-2.5">
          <span className="w-24 truncate text-[12.5px] text-slate-600">{a.name}</span>
          <ProgressBar value={a.count} max={max} colorClassName="bg-indigo-400" />
          <span className="w-6 text-right text-[12.5px] font-medium text-slate-600">{a.count}</span>
        </div>
      ))}
      {report.unassigned > 0 && (
        <div className="flex items-center gap-2.5">
          <span className="w-24 truncate text-[12.5px] text-slate-400">{t('dashboard.workload.unassigned')}</span>
          <ProgressBar value={report.unassigned} max={max} colorClassName="bg-slate-300" />
          <span className="w-6 text-right text-[12.5px] font-medium text-slate-400">{report.unassigned}</span>
        </div>
      )}
      {report.agents.length === 0 && report.unassigned === 0 && (
        <p className="text-xs text-slate-400">{t('dashboard.workload.empty')}</p>
      )}
    </div>
  );
}

function OnboardingChecklistWidget({ checklist }: { checklist: OnboardingChecklist }) {
  const { t } = useTranslation();
  if (checklist.allDone) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckIcon width={12} height={12} />
        </span>
        {t('dashboard.onboarding.allDone')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {checklist.items.map((item) => (
        <Link
          key={item.key}
          to={item.href}
          className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-[13px] hover:bg-slate-50"
        >
          <span
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
              item.done ? 'bg-emerald-100 text-emerald-600' : 'border border-slate-300 text-transparent'
            }`}
          >
            <CheckIcon width={12} height={12} />
          </span>
          <span className={item.done ? 'text-slate-400 line-through' : 'text-slate-700'}>{item.label}</span>
        </Link>
      ))}
    </div>
  );
}

function RecentActivityWidget({ tickets }: { tickets: Ticket[] }) {
  const { t } = useTranslation();
  if (tickets.length === 0) return <p className="text-xs text-slate-400">{t('dashboard.recentActivity.empty')}</p>;
  return (
    <div className="flex flex-col gap-2">
      {tickets.map((t) => (
        <Link key={t.id} to={`/tickets/${t.id}`} className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50">
          <span className="truncate text-[12.5px] text-slate-700">
            <span className="text-slate-400">#{t.number}</span> {t.subject}
          </span>
          <Badge tone={STATUS_CATEGORY_TONE[t.status.category]} dot>
            {t.status.label}
          </Badge>
        </Link>
      ))}
    </div>
  );
}
