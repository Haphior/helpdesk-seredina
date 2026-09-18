import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, ApiError } from '../lib/api';
import type { Problem, ProblemStatus, UserSummary } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';
import { Card } from '../components/Card';
import { PROBLEM_STATUS_TONE } from '../lib/format';

const TABS: { key: ProblemStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'UNDER_INVESTIGATION', label: 'Under investigation' },
  { key: 'KNOWN_ERROR', label: 'Known error' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
];

const PAGE_SIZE = 50;

export function Problems() {
  const [tab, setTab] = useState<ProblemStatus | 'ALL'>('ALL');
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load(offset = 0) {
    if (offset > 0) setLoadingMore(true);
    const params = new URLSearchParams();
    if (tab !== 'ALL') params.set('status', tab);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    apiGet<{ problems: Problem[]; total: number }>(`/problems?${params.toString()}`)
      .then((res) => {
        setProblems((prev) => (offset > 0 && prev ? [...prev, ...res.problems] : res.problems));
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load problems'))
      .finally(() => setLoadingMore(false));
  }

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    apiGet<{ users: UserSummary[] }>('/users').then((res) => setUsers(res.users)).catch(() => {});
  }, []);

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Problems</h1>
        <Button onClick={() => setShowCreate(true)}>New problem</Button>
      </div>
      <p className="mb-4 text-[13.5px] text-slate-500">
        A root cause behind one or more tickets — separate from the incidents it's causing, so a fix (and a workaround while
        you wait for one) has somewhere to live.
      </p>

      <div className="mb-5 flex gap-1 rounded-[9px] bg-slate-100 p-[3px]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {problems === null && <p className="text-sm text-slate-500">Loading…</p>}
      {problems?.length === 0 && <p className="text-sm text-slate-500">No problems here.</p>}

      {problems && problems.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {problems.map((p) => (
              <Link
                key={p.id}
                to={`/problems/${p.id}`}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-slate-400">#{p.number}</span>
                    <span className="text-[14px] font-semibold text-slate-800">{p.title}</span>
                  </div>
                  {p.rootCause && <div className="truncate text-[12.5px] text-slate-400">{p.rootCause}</div>}
                </div>
                <div className="flex items-center gap-3">
                  {p.owner ? (
                    <div className="flex items-center gap-1.5">
                      <Avatar name={p.owner.name} size={18} />
                      <span className="text-[12.5px] text-slate-500">{p.owner.name}</span>
                    </div>
                  ) : (
                    <span className="text-[12.5px] text-slate-400">Unowned</span>
                  )}
                  <span className="text-[12.5px] text-slate-400">
                    {p.tickets.length} linked ticket{p.tickets.length === 1 ? '' : 's'}
                  </span>
                  <Badge tone={PROBLEM_STATUS_TONE[p.status]} dot>
                    {p.status.replace('_', ' ')}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {problems && problems.length < total && (
        <div className="flex justify-center pt-4">
          <Button variant="secondary" onClick={() => load(problems.length)} isLoading={loadingMore}>
            {loadingMore ? 'Loading…' : `Load more (${total - problems.length} remaining)`}
          </Button>
        </div>
      )}

      {showCreate && <CreateProblemModal users={users} onClose={() => setShowCreate(false)} onCreated={() => load(0)} />}
    </div>
  );
}

function CreateProblemModal({
  users,
  onClose,
  onCreated,
}: {
  users: UserSummary[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/problems', { title, description: description || undefined, ownerId: ownerId || undefined });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create problem');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New problem" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intermittent VPN drops" required />

        <Textarea label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />

        <Select label="Owner (optional)" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">Unowned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
