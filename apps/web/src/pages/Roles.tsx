import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Permission, Role } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';

const ALL_PERMISSIONS: Permission[] = [
  'tickets:read',
  'tickets:write',
  'tickets:manage_all',
  'assets:read',
  'assets:manage',
  'channels:manage',
  'users:manage',
  'roles:manage',
];

export function Roles() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Role | 'new' | null>(null);

  function load() {
    apiGet<{ roles: Role[] }>('/roles')
      .then((res) => setRoles(res.roles))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load roles'));
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(role: Role) {
    if (!confirm(`Delete the "${role.name}" role?`)) return;
    try {
      await apiDelete(`/roles/${role.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete role');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Roles</h1>
        <button
          onClick={() => setEditing('new')}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New role
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Every role here is available immediately when assigning a user (Administration → Users) —
        no restart, no fixed list of three.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {roles === null && <p className="text-sm text-slate-500">Loading…</p>}

      {roles && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {roles.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3.5">
                <button onClick={() => setEditing(r)} className="min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-slate-800">{r.name}</span>
                    <span className="font-mono text-[11.5px] text-slate-400">{r.key}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.permissions.map((p) => (
                      <Badge key={p} tone="slate">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </button>
                {r.key !== 'admin' && (
                  <button onClick={() => remove(r)} className="flex-shrink-0 text-xs text-slate-400 hover:text-rose-600">
                    delete
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && <RoleModal role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function RoleModal({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState(role?.key ?? '');
  const [name, setName] = useState(role?.name ?? '');
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? []);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function togglePermission(p: Permission) {
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (role) {
        await apiPatch(`/roles/${role.id}`, { name, permissions });
      } else {
        await apiPost('/roles', { key, name, permissions });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save role');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={role ? 'Edit role' : 'New role'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        {!role && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Key</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="billing_viewer"
              required
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <span className="mt-1 block text-[12px] text-slate-400">Lowercase, alphanumeric and underscores. Can't be changed later.</span>
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Billing Viewer"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Permissions</span>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-[12.5px]">
                <input type="checkbox" checked={permissions.includes(p)} onChange={() => togglePermission(p)} />
                <span className="font-mono">{p}</span>
              </label>
            ))}
          </div>
        </div>

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
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
