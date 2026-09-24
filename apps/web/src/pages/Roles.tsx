import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Permission, Role } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';

const ALL_PERMISSIONS: Permission[] = [
  'tickets:read',
  'tickets:write',
  'tickets:manage_all',
  'assets:read',
  'assets:manage',
  'channels:manage',
  'users:manage',
  'roles:manage',
  'audit:read',
];

export function Roles() {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Role | 'new' | null>(null);

  function load() {
    apiGet<{ roles: Role[] }>('/roles')
      .then((res) => setRoles(res.roles))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('roles.loadFailed')));
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(role: Role) {
    if (!confirm(t('roles.confirmDelete', { name: role.name }))) return;
    try {
      await apiDelete(`/roles/${role.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('roles.deleteFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('roles.title')}</h1>
        <Button onClick={() => setEditing('new')}>{t('roles.new')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('roles.intro')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {roles === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {roles && (
        <Card className="overflow-hidden p-0">
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
                        {t(`roles.permissions.${p}`, { defaultValue: p })}
                      </Badge>
                    ))}
                  </div>
                </button>
                {r.key !== 'admin' && (
                  <button onClick={() => remove(r)} className="flex-shrink-0 text-xs text-slate-400 hover:text-rose-600">
                    {t('roles.delete')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {editing && <RoleModal role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function RoleModal({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('roles.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={role ? t('roles.edit') : t('roles.new')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        {!role && (
          <div>
            <Input label={t('roles.key')} value={key} onChange={(e) => setKey(e.target.value)} placeholder="billing_viewer" required />
            <span className="mt-1 block text-[12px] text-slate-400">{t('roles.keyHint')}</span>
          </div>
        )}

        <Input label={t('roles.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder="Billing Viewer" required />

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">{t('roles.permissionsLabel')}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={permissions.includes(p)}
                  onChange={() => togglePermission(p)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
                />
                <span>
                  {t(`roles.permissions.${p}`, { defaultValue: p })} <span className="font-mono text-[11px] text-slate-400">{p}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
