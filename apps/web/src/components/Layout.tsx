import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiGet } from '../lib/api';
import type { Permission } from '../lib/types';
import { Avatar } from './Avatar';
import { NotificationBell } from './NotificationBell';
import {
  AssetsIcon,
  BellIcon,
  BoltIcon,
  BookIcon,
  CalendarIcon,
  CatalogIcon,
  ChecklistIcon,
  ClockIcon,
  DashboardIcon,
  KeyIcon,
  LayersIcon,
  LogoutIcon,
  MailIcon,
  SlidersIcon,
  ServiceMapIcon,
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
}

// Grouped, not one flat list -- past ~8 items a sidebar needs chunking to stay
// scannable. Groups follow how an agent actually thinks about the app: daily
// work, the CMDB, then the two flavors of admin-only configuration (how
// tickets/processes behave, vs. tenant/account-level setup).
const navGroups: { label: string; items: { to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; permission?: Permission }[] }[] = [
  {
    label: 'Work',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
      { to: '/tickets', label: 'Tickets', icon: TicketIcon },
      { to: '/processes', label: 'Processes', icon: ChecklistIcon, permission: 'tickets:write' },
      { to: '/problems', label: 'Problems', icon: WarningIcon, permission: 'tickets:write' },
      { to: '/knowledge-base', label: 'Knowledge Base', icon: BookIcon, permission: 'tickets:read' },
    ],
  },
  {
    label: 'CMDB',
    items: [
      { to: '/assets', label: 'Assets', icon: AssetsIcon },
      { to: '/equipment-catalog', label: 'Equipment Catalog', icon: LayersIcon, permission: 'assets:manage' },
      { to: '/services', label: 'Services', icon: ServiceMapIcon, permission: 'assets:manage' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/custom-fields', label: 'Custom Fields', icon: SlidersIcon, permission: 'tickets:manage_all' },
      { to: '/service-catalog', label: 'Service Catalog', icon: CatalogIcon, permission: 'tickets:manage_all' },
      { to: '/process-templates', label: 'Process Templates', icon: ChecklistIcon, permission: 'tickets:manage_all' },
      { to: '/macros', label: 'Macros', icon: BoltIcon, permission: 'tickets:manage_all' },
      { to: '/webhooks', label: 'Webhooks', icon: WebhookIcon, permission: 'tickets:manage_all' },
      { to: '/sla-policies', label: 'SLA Policies', icon: ClockIcon, permission: 'tickets:manage_all' },
      { to: '/on-call', label: 'On-Call & Escalation', icon: BellIcon, permission: 'tickets:manage_all' },
      { to: '/business-hours', label: 'Business Hours', icon: CalendarIcon, permission: 'tickets:manage_all' },
      { to: '/ai-usage', label: 'AI Usage', icon: SparkleIcon, permission: 'tickets:manage_all' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users', icon: UsersIcon, permission: 'users:manage' },
      { to: '/api-keys', label: 'API Keys', icon: KeyIcon },
      { to: '/email-channels', label: 'Email Channels', icon: MailIcon, permission: 'channels:manage' },
    ],
  },
];

export function Layout() {
  const { logout, hasPermission } = useAuth();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    apiGet<Me>('/auth/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  return (
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
              <div key={group.label}>
                <span className="mb-1 block px-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {group.label}
                </span>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium ${
                          isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                        }`
                      }
                    >
                      <item.icon />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 border-t border-slate-100 px-4 py-3.5">
          <Avatar name={me?.name ?? '?'} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-slate-800">{me?.name ?? '…'}</div>
            <div className="truncate text-[11.5px] capitalize text-slate-400">{me?.role?.key ?? ''}</div>
          </div>
          <button onClick={logout} aria-label="Log out" className="flex-shrink-0 text-slate-400 hover:text-slate-700">
            <LogoutIcon width={16} height={16} />
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
