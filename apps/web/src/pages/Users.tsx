import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Role, UserSummary } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { useAuth } from '../auth/AuthContext';

export function Users() {
  const { t } = useTranslation();
  const { payload } = useAuth();
  const [mfaRequired, setMfaRequired] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resettingPassword, setResettingPassword] = useState<UserSummary | null>(null);

  function load() {
    apiGet<{ users: UserSummary[] }>('/users')
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('users.loadFailed')));
    apiGet<{ roles: Role[] }>('/roles')
      .then((res) => setRoles(res.roles))
      .catch(() => {});
    apiGet<{ required: boolean }>('/auth/mfa')
      .then((res) => setMfaRequired(res.required))
      .catch(() => {});
  }

  async function toggleMfaRequired() {
    if (mfaRequired === null) return;
    if (!mfaRequired && !confirm(t('users.mfa.confirmRequire'))) return;
    try {
      const res = await apiPatch<{ required: boolean }>('/auth/mfa-policy', { required: !mfaRequired });
      setMfaRequired(res.required);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('users.mfa.policyFailed'));
    }
  }

  async function resetMfa(user: UserSummary) {
    if (!confirm(t('users.mfa.confirmReset', { name: user.name }))) return;
    try {
      await apiPost(`/users/${user.id}/mfa/reset`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('users.mfa.resetFailed'));
    }
  }

  useEffect(load, []);

  async function changeRole(userId: string, roleKey: string) {
    try {
      await apiPatch(`/users/${userId}`, { roleKey });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('users.roleFailed'));
    }
  }

  async function toggleActive(user: UserSummary) {
    if (user.isActive && !confirm(t('users.confirmDeactivate', { name: user.name }))) return;
    try {
      await apiPatch(`/users/${user.id}`, { isActive: !user.isActive });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('users.updateFailed'));
    }
  }

  async function unlock(user: UserSummary) {
    try {
      await apiPost(`/users/${user.id}/unlock`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('users.unlockFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('users.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('users.newUser')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('users.intro')}
      </p>

      {mfaRequired !== null && (
        <Card className="mb-4 flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-[13.5px] font-semibold text-slate-800">{t('users.mfa.policyTitle')}</p>
            <p className="text-[12.5px] text-slate-500">{mfaRequired ? t('users.mfa.policyOn') : t('users.mfa.policyOff')}</p>
          </div>
          <Button variant={mfaRequired ? 'ghost' : 'primary'} onClick={toggleMfaRequired}>
            {mfaRequired ? t('users.mfa.stopRequiring') : t('users.mfa.require')}
          </Button>
        </Card>
      )}

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {users === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {users && users.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-[1fr_1fr_140px_190px_230px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
            <span>{t('users.col.name')}</span>
            <span>{t('users.col.email')}</span>
            <span>{t('users.col.role')}</span>
            <span>{t('users.col.status')}</span>
            <span></span>
          </div>
          <div className="divide-y divide-slate-100">
            {users.map((u) => (
              <div
                key={u.id}
                className={`grid grid-cols-[1fr_1fr_140px_190px_230px] items-center gap-3 px-5 py-3 ${!u.isActive ? 'opacity-50' : ''}`}
              >
                <span className="truncate text-[13.5px] font-semibold text-slate-800">{u.name}</span>
                <span className="truncate text-[13px] text-slate-500">{u.email}</span>
                <Select
                  hideLabel
                  aria-label={t('users.roleFor', { name: u.name })}
                  value={u.role?.key ?? ''}
                  onChange={(e) => changeRole(u.id, e.target.value)}
                  disabled={!u.isActive}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-1.5">
                  {u.isActive ? (
                    <Badge tone="emerald" dot>
                      {t('users.active')}
                    </Badge>
                  ) : (
                    <Badge tone="slate">{t('users.deactivated')}</Badge>
                  )}
                  {u.isLocked && <Badge tone="rose">{t('users.locked')}</Badge>}
                  {u.mfaEnabled && <Badge tone="indigo">{t('users.mfa.badge')}</Badge>}
                </div>
                <div className="flex flex-shrink-0 items-center justify-end gap-2.5 text-xs">
                  {u.isLocked && (
                    <button onClick={() => unlock(u)} className="text-slate-400 hover:text-indigo-600">
                      {t('users.unlock')}
                    </button>
                  )}
                  <button onClick={() => setResettingPassword(u)} className="text-slate-400 hover:text-indigo-600">
                    {t('users.resetPassword')}
                  </button>
                  {u.mfaEnabled && u.id !== payload?.sub && (
                    <button onClick={() => resetMfa(u)} className="text-slate-400 hover:text-indigo-600">
                      {t('users.mfa.reset')}
                    </button>
                  )}
                  {u.id !== payload?.sub && (
                    <button
                      onClick={() => toggleActive(u)}
                      className={u.isActive ? 'text-slate-400 hover:text-rose-600' : 'text-slate-400 hover:text-indigo-600'}
                    >
                      {u.isActive ? t('users.deactivate') : t('users.reactivate')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
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
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('users.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('users.newUser')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label={t('users.col.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label={t('users.col.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input
          label={t('users.initialPassword')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <Select label={t('users.col.role')} value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? t('common.creating') : t('common.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserSummary; onClose: () => void }) {
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('users.resetFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('users.resetTitle', { name: user.name })} onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {t('users.resetDone', { name: user.name })}
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('users.done')}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Input
            label={t('users.newPassword')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" isLoading={submitting}>
              {submitting ? t('common.saving') : t('users.resetPasswordButton')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
