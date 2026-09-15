import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Role, UserSummary } from '../lib/types';
import { Modal } from '../components/Modal';

export function Users() {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

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

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New user
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Agents/admins in this organization. No invite email yet — share the password with them directly.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {users === null && <p className="text-sm text-slate-500">Loading…</p>}

      {users && users.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-900">{u.name}</td>
                  <td className="px-4 py-2 text-slate-600">{u.email}</td>
                  <td className="px-4 py-2">
                    <select
                      value={u.role?.key ?? ''}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateUserModal roles={roles} onClose={() => setShowCreate(false)} onCreated={load} />
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

        {error && <p className="text-sm text-red-600">{error}</p>}

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
