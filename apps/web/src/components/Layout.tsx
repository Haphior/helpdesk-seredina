import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const navItems = [
  { to: '/tickets', label: 'Tickets' },
  { to: '/assets', label: 'Assets' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/users', label: 'Users', permission: 'users:manage' as const },
];

export function Layout() {
  const { logout, hasPermission } = useAuth();

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-56 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4 text-lg font-semibold">Seredina</div>
        <nav className="flex-1 space-y-1 p-2">
          {navItems
            .filter((item) => !item.permission || hasPermission(item.permission))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block rounded-md px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
        </nav>
        <div className="border-t border-slate-200 p-2">
          <button
            onClick={logout}
            className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
