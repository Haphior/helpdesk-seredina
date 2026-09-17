import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiGet } from '../lib/api';
import { Avatar } from './Avatar';
import {
  AssetsIcon,
  BoltIcon,
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

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { to: '/tickets', label: 'Tickets', icon: TicketIcon },
  { to: '/processes', label: 'Processes', icon: ChecklistIcon, permission: 'tickets:write' as const },
  { to: '/problems', label: 'Problems', icon: WarningIcon, permission: 'tickets:write' as const },
  { to: '/assets', label: 'Assets', icon: AssetsIcon },
  { to: '/equipment-catalog', label: 'Equipment Catalog', icon: LayersIcon, permission: 'assets:manage' as const },
  { to: '/api-keys', label: 'API Keys', icon: KeyIcon },
  { to: '/users', label: 'Users', icon: UsersIcon, permission: 'users:manage' as const },
  { to: '/email-channels', label: 'Email Channels', icon: MailIcon, permission: 'channels:manage' as const },
  { to: '/custom-fields', label: 'Custom Fields', icon: SlidersIcon, permission: 'tickets:manage_all' as const },
  { to: '/service-catalog', label: 'Service Catalog', icon: CatalogIcon, permission: 'tickets:manage_all' as const },
  { to: '/process-templates', label: 'Process Templates', icon: ChecklistIcon, permission: 'tickets:manage_all' as const },
  { to: '/webhooks', label: 'Webhooks', icon: WebhookIcon, permission: 'tickets:manage_all' as const },
  { to: '/macros', label: 'Macros', icon: BoltIcon, permission: 'tickets:manage_all' as const },
  { to: '/sla-policies', label: 'SLA Policies', icon: ClockIcon, permission: 'tickets:manage_all' as const },
  { to: '/business-hours', label: 'Business Hours', icon: CalendarIcon, permission: 'tickets:manage_all' as const },
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
          <div className="flex items-center gap-2.5">
            <Logo size={26} />
            <span className="text-[15px] font-extrabold tracking-tight text-slate-900">Seredina</span>
          </div>
          <span className="truncate pl-[35px] text-xs text-slate-400">{me?.tenantName ?? ' '}</span>
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          {navItems
            .filter((item) => !item.permission || hasPermission(item.permission))
            .map((item) => (
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
