import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Role, UserSummary } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { useAuth } from '../auth/AuthContext';

export function Users() {
  const { payload } = useAuth();
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resettingPassword, setResettingPassword] = useState<UserSummary | null>(null);

  function load() {
    apiGet<{ users: UserSummary[] }>('/users')
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load users'));
    apiGet<{ roles: Role[] }>('/roles')
      .then((res) => setRoles(res.roles))
      .catch(() => {});
  }

  useEffect(load, []);

  async function changeRole(userId: string, roleKey: string) {
    try {
      await apiPatch(`/users/${userId}`, { roleKey });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change role');
    }
  }

  async function toggleActive(user: UserSummary) {
    if (user.isActive && !confirm(`Deactivate ${user.name}? They won't be able to log in until reactivated.`)) return;
    try {
      await apiPatch(`/users/${user.id}`, { isActive: !user.isActive });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update user');
    }
  }

  async function unlock(user: UserSummary) {
    try {
      await apiPost(`/users/${user.id}/unlock`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to unlock user');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Users</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New user
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Agents/admins in this organization. No invite email yet: share the password with them directly.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {users === null && <p className="text-sm text-slate-500">Loading…</p>}

      {users && users.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1fr_1fr_140px_160px_170px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span></span>
          </div>
          <div className="divide-y divide-slate-100">
            {users.map((u) => (
              <div
                key={u.id}
                className={`grid grid-cols-[1fr_1fr_140px_160px_170px] items-center gap-3 px-5 py-3 ${!u.isActive ? 'opacity-50' : ''}`}
              >
                <span className="truncate text-[13.5px] font-semibold text-slate-800">{u.name}</span>
                <span className="truncate text-[13px] text-slate-500">{u.email}</span>
                <select
                  value={u.role?.key ?? ''}
                  onChange={(e) => changeRole(u.id, e.target.value)}
                  disabled={!u.isActive}
                  className="w-fit rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5">
                  {u.isActive ? (
                    <Badge tone="emerald" dot>
                      Active
                    </Badge>
                  ) : (
                    <Badge tone="slate">Deactivated</Badge>
                  )}
                  {u.isLocked && <Badge tone="rose">Locked</Badge>}
                </div>
                <div className="flex flex-shrink-0 items-center justify-end gap-2.5 text-xs">
                  {u.isLocked && (
                    <button onClick={() => unlock(u)} className="text-slate-400 hover:text-indigo-600">
                      unlock
                    </button>
                  )}
                  <button onClick={() => setResettingPassword(u)} className="text-slate-400 hover:text-indigo-600">
                    reset password
                  </button>
                  {u.id !== payload?.sub && (
                    <button
                      onClick={() => toggleActive(u)}
                      className={u.isActive ? 'text-slate-400 hover:text-rose-600' : 'text-slate-400 hover:text-indigo-600'}
                    >
                      {u.isActive ? 'deactivate' : 'reactivate'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && <CreateUserModal roles={roles} onClose={() => setShowCreate(false)} onCreated={load} />}
      {resettingPassword && (
        <ResetPasswordModal user={resettingPassword} onClose={() => setResettingPassword(null)} />
      )}
    </div>
  );
}

function CreateUserModal({
  roles,
  onClose,
  onCreated,
}: {
  roles: Role[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [roleKey, setRoleKey] = useState(roles.find((r) => r.key === 'agent')?.key ?? roles[0]?.key ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // roles can still be [] at mount if this modal opens before the parent's own
  // /roles fetch resolves -- the useState initializer above only ever runs
  // once, so a still-empty roleKey needs this effect to pick a default once
  // roles actually arrive, or "Create" silently 400s on an empty roleKey.
  useEffect(() => {
    if (!roleKey && roles.length > 0) {
      setRoleKey(roles.find((r) => r.key === 'agent')?.key ?? roles[0].key);
    }
  }, [roles, roleKey]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/users', { email, name, password, roleKey });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New user" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Initial password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Role</span>
          <select
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserSummary; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost(`/users/${user.id}/reset-password`, { password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Reset password for ${user.name}`} onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Password reset. Share the new password with {user.name} directly — there's no email flow to send it for you.
          </p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Reset password'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
