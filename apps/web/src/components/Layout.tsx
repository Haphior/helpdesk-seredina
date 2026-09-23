import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { apiGet } from '../lib/api';
import type { Permission } from '../lib/types';
import { ThemeProvider } from '../theme/ThemeContext';
import { Avatar } from './Avatar';
import { GuidedTour } from './GuidedTour';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NotificationBell } from './NotificationBell';
import {
  AssetsIcon,
  DevicesIcon,
  BellIcon,
  BoltIcon,
  BookIcon,
  CalendarIcon,
  CatalogIcon,
  CheckIcon,
  ChecklistIcon,
  ClockIcon,
  DashboardIcon,
  DownloadIcon,
  HelpIcon,
  KeyIcon,
  LayersIcon,
  LogoutIcon,
  MailIcon,
  SlidersIcon,
  ServiceMapIcon,
  BrandIcon,
  PaletteIcon,
  PaperPlaneIcon,
  ShieldIcon,
  SparkleIcon,
  TicketIcon,
  UsersIcon,
  WarningIcon,
  WebhookIcon,
} from './icons';
import { Logo } from './Logo';

interface Me {
  name: string;
  email: string;
  role: { key: string } | null;
  tenantName: string;
  tourCompletedAt: string | null;
}

// Grouped, not one flat list -- past ~8 items a sidebar needs chunking to stay
// scannable. Groups follow how an agent actually thinks about the app: daily
// work, the CMDB, then the three flavors of admin-only configuration (how
// tickets/processes/catalog items behave, vs. integrations/scheduling/
// insight-ops, vs. tenant/account-level setup). Configuration itself split
// into two groups once Ticket Statuses pushed it to 11 flat items.
// `labelKey`/`itemKey` index into the `nav.groups`/`nav.items` translation
// namespaces (src/i18n/locales/*.json) rather than hardcoding English.
const navGroups: {
  labelKey: string;
  items: { to: string; itemKey: string; icon: ComponentType<SVGProps<SVGSVGElement>>; permission?: Permission }[];
}[] = [
  {
    labelKey: 'work',
    items: [
      { to: '/dashboard', itemKey: 'dashboard', icon: DashboardIcon },
      { to: '/tickets', itemKey: 'tickets', icon: TicketIcon },
      { to: '/processes', itemKey: 'processes', icon: ChecklistIcon, permission: 'tickets:write' },
      { to: '/problems', itemKey: 'problems', icon: WarningIcon, permission: 'tickets:write' },
      { to: '/knowledge-base', itemKey: 'knowledgeBase', icon: BookIcon, permission: 'tickets:read' },
    ],
  },
  {
    labelKey: 'cmdb',
    items: [
      { to: '/assets', itemKey: 'assets', icon: AssetsIcon },
      { to: '/devices', itemKey: 'devices', icon: DevicesIcon, permission: 'assets:read' },
      { to: '/contracts', itemKey: 'contracts', icon: CatalogIcon, permission: 'assets:read' },
      { to: '/equipment-catalog', itemKey: 'equipmentCatalog', icon: LayersIcon, permission: 'assets:manage' },
      { to: '/services', itemKey: 'services', icon: ServiceMapIcon, permission: 'assets:manage' },
    ],
  },
  {
    labelKey: 'configuration',
    items: [
      { to: '/ticket-statuses', itemKey: 'ticketStatuses', icon: CheckIcon, permission: 'tickets:manage_all' },
      { to: '/custom-fields', itemKey: 'customFields', icon: SlidersIcon, permission: 'tickets:manage_all' },
      { to: '/service-catalog', itemKey: 'serviceCatalog', icon: CatalogIcon, permission: 'tickets:manage_all' },
      { to: '/process-templates', itemKey: 'processTemplates', icon: ChecklistIcon, permission: 'tickets:manage_all' },
      { to: '/macros', itemKey: 'macros', icon: BoltIcon, permission: 'tickets:manage_all' },
      { to: '/sla-policies', itemKey: 'slaPolicies', icon: ClockIcon, permission: 'tickets:manage_all' },
    ],
  },
  {
    labelKey: 'operations',
    items: [
      { to: '/webhooks', itemKey: 'webhooks', icon: WebhookIcon, permission: 'tickets:manage_all' },
      { to: '/on-call', itemKey: 'onCall', icon: BellIcon, permission: 'tickets:manage_all' },
      { to: '/business-hours', itemKey: 'businessHours', icon: CalendarIcon, permission: 'tickets:manage_all' },
      { to: '/ai-usage', itemKey: 'aiUsage', icon: SparkleIcon, permission: 'tickets:manage_all' },
      { to: '/ai-agent-activity', itemKey: 'aiAgentActivity', icon: ShieldIcon, permission: 'tickets:manage_all' },
      { to: '/ai-settings', itemKey: 'aiSettings', icon: SparkleIcon, permission: 'tickets:manage_all' },
      { to: '/data-export', itemKey: 'dataExport', icon: DownloadIcon, permission: 'tickets:manage_all' },
    ],
  },
  {
    labelKey: 'administration',
    items: [
      { to: '/users', itemKey: 'users', icon: UsersIcon, permission: 'users:manage' },
      { to: '/roles', itemKey: 'roles', icon: ShieldIcon, permission: 'roles:manage' },
      { to: '/sso', itemKey: 'sso', icon: KeyIcon, permission: 'users:manage' },
      { to: '/audit-log', itemKey: 'auditLog', icon: ChecklistIcon, permission: 'audit:read' },
      { to: '/api-keys', itemKey: 'apiKeys', icon: KeyIcon },
      { to: '/email-channels', itemKey: 'emailChannels', icon: MailIcon, permission: 'channels:manage' },
      { to: '/telegram', itemKey: 'telegram', icon: PaperPlaneIcon, permission: 'channels:manage' },
      { to: '/monitoring-integrations', itemKey: 'monitoringIntegrations', icon: WarningIcon, permission: 'channels:manage' },
      { to: '/customer-portal', itemKey: 'customerPortal', icon: UsersIcon, permission: 'tickets:manage_all' },
      { to: '/appearance', itemKey: 'appearance', icon: PaletteIcon, permission: 'tickets:manage_all' },
      { to: '/branding', itemKey: 'branding', icon: BrandIcon, permission: 'tickets:manage_all' },
    ],
  },
];

export function Layout() {
  const { t } = useTranslation();
  const { logout, hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    apiGet<Me>('/auth/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  // Auto-runs once, for a user who's never seen it, on first landing at
  // /dashboard (where a fresh login/registration always redirects to) --
  // one of the tour's own steps points at the Dashboard's "Get started"
  // widget, so running it from any other page would just show that step's
  // fallback centered card instead of the real thing. Replaying it later
  // (the help button below) always navigates to /dashboard first for the
  // same reason.
  useEffect(() => {
    if (me && !me.tourCompletedAt && location.pathname === '/dashboard') {
      setShowTour(true);
    }
  }, [me, location.pathname]);

  return (
    <ThemeProvider>
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      <aside className="flex w-[248px] flex-col border-r border-slate-200 bg-white">
        <div className="flex flex-col gap-0.5 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <Logo size={26} />
              <span className="text-[15px] font-extrabold tracking-tight text-slate-900">Seredina</span>
            </div>
            <NotificationBell />
          </div>
          <span className="truncate pl-[35px] text-xs text-slate-400">{me?.tenantName ?? ' '}</span>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter((item) => !item.permission || hasPermission(item.permission));
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.labelKey}>
                <span className="mb-1 block px-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {t(`nav.groups.${group.labelKey}`)}
                </span>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      data-tour={`nav-${item.itemKey}`}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium ${
                          isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                        }`
                      }
                    >
                      <item.icon />
                      {t(`nav.items.${item.itemKey}`)}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5">
          <div className="flex-1" data-tour="language-switcher">
            <LanguageSwitcher />
          </div>
          <button
            onClick={() => {
              if (location.pathname !== '/dashboard') navigate('/dashboard');
              setShowTour(true);
            }}
            aria-label={t('tour.replay')}
            title={t('tour.replay')}
            className="flex-shrink-0 text-slate-400 hover:text-slate-700"
          >
            <HelpIcon width={16} height={16} />
          </button>
        </div>
        <div className="flex items-center gap-2.5 border-t border-slate-100 px-4 py-3.5">
          <Avatar name={me?.name ?? '?'} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-slate-800">{me?.name ?? '…'}</div>
            <div className="truncate text-[11.5px] capitalize text-slate-400">{me?.role?.key ?? ''}</div>
          </div>
          <button
            onClick={() => navigate('/account/security')}
            aria-label={t('layout.accountSecurity')}
            title={t('layout.accountSecurity')}
            className="flex-shrink-0 text-slate-400 hover:text-slate-700"
          >
            <ShieldIcon width={16} height={16} />
          </button>
          <button onClick={logout} aria-label={t('layout.logOut')} className="flex-shrink-0 text-slate-400 hover:text-slate-700">
            <LogoutIcon width={16} height={16} />
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {showTour && location.pathname === '/dashboard' && (
        <GuidedTour onClose={() => setShowTour(false)} />
      )}
    </div>
    </ThemeProvider>
  );
}
