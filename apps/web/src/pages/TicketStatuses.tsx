import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { TicketStatus, TicketStatusCategory } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { ChevronDownIcon, ChevronUpIcon } from '../components/icons';
import { STATUS_CATEGORY_TONE } from '../lib/format';

const CATEGORIES: TicketStatusCategory[] = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'];

export function TicketStatuses() {
  const [statuses, setStatuses] = useState<TicketStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<TicketStatus | null>(null);

  function load() {
    apiGet<{ statuses: TicketStatus[] }>('/ticket-statuses')
      .then((res) => setStatuses(res.statuses))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load ticket statuses'));
  }

  useEffect(load, []);

  async function remove(status: TicketStatus) {
    if (!confirm(`Delete status "${status.label}"?`)) return;
    try {
      await apiDelete(`/ticket-statuses/${status.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete status');
    }
  }

  async function move(status: TicketStatus, direction: -1 | 1) {
    if (!statuses) return;
    const i = statuses.findIndex((s) => s.id === status.id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= statuses.length) return;
    const other = statuses[j];
    try {
      await Promise.all([
        apiPatch(`/ticket-statuses/${status.id}`, { sortOrder: other.sortOrder }),
        apiPatch(`/ticket-statuses/${other.id}`, { sortOrder: status.sortOrder }),
      ]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reorder');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Ticket Statuses</h1>
        <Button onClick={() => setShowCreate(true)}>New status</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Every status belongs to one of four categories (Open/Pending/Resolved/Closed) that drive SLA tracking and
        reporting — labels are yours to customize, categories are fixed.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {statuses === null && <p className="text-sm text-slate-500">Loading…</p>}

      {statuses && statuses.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {statuses.map((s, i) => (
              <div key={s.id} className="group flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-1.5">
                  <div className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      iconOnly
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${s.label} status up`}
                      onClick={() => move(s, -1)}
                      disabled={i === 0}
                      className="!h-5 !w-5"
                    >
                      <ChevronUpIcon width={12} height={12} />
                    </Button>
                    <Button
                      iconOnly
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${s.label} status down`}
                      onClick={() => move(s, 1)}
                      disabled={i === statuses.length - 1}
                      className="!h-5 !w-5"
                    >
                      <ChevronDownIcon width={12} height={12} />
                    </Button>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-slate-800">{s.label}</span>
                      {s.key === 'open' && <span className="text-[11px] text-slate-400">(new tickets start here)</span>}
                    </div>
                    <code className="text-[12px] text-slate-400">{s.key}</code>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={STATUS_CATEGORY_TONE[s.category]} dot>
                    {s.category}
                  </Badge>
                  <button onClick={() => setEditing(s)} className="text-xs text-slate-400 hover:text-indigo-600">
                    edit
                  </button>
                  {s.key !== 'open' && (
                    <button onClick={() => remove(s)} className="text-xs text-slate-400 hover:text-rose-600">
                      delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showCreate && <StatusModal onClose={() => setShowCreate(false)} onSaved={load} />}
      {editing && <StatusModal status={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function StatusModal({
  status,
  onClose,
  onSaved,
}: {
  status?: TicketStatus;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState(status?.key ?? '');
  const [label, setLabel] = useState(status?.label ?? '');
  const [category, setCategory] = useState<TicketStatusCategory>(status?.category ?? 'OPEN');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (status) {
        await apiPatch(`/ticket-statuses/${status.id}`, { label, category });
      } else {
        await apiPost('/ticket-statuses', { key, label, category });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save status');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={status ? `Edit "${status.label}"` : 'New status'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Waiting on Vendor" required />

        {!status && (
          <div>
            <Input
              label="Key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="waiting_on_vendor"
              pattern="[a-z][a-z0-9_]*"
              required
            />
            <span className="mt-1 block text-xs text-slate-400">
              Lowercase, no spaces — the internal identifier, fixed once created.
            </span>
          </div>
        )}

        <div>
          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as TicketStatusCategory)}
            disabled={status?.key === 'open'}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <span className="mt-1 block text-xs text-slate-400">
            Drives SLA tracking and reporting — Closed excludes a ticket from SLA-compliance and open-workload counts.
          </span>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
