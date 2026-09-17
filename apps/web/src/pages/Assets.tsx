import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Asset, AssetStatus, AssetType, DiscoveryJob } from '../lib/types';
import { Badge } from '../components/Badge';
import { AssetFormModal, type AssetFormValues } from '../components/AssetFormModal';
import { SearchIcon } from '../components/icons';
import { formatDateTime } from '../lib/format';

const JOB_STATUS_TONE = {
  PENDING: 'slate',
  RUNNING: 'sky',
  COMPLETED: 'emerald',
  FAILED: 'rose',
} as const;

const ASSET_STATUS_TONE: Record<AssetStatus, 'emerald' | 'slate' | 'amber'> = {
  ACTIVE: 'emerald',
  RETIRED: 'slate',
  INACTIVE: 'amber',
};

const ASSET_TYPES: AssetType[] = ['SERVER', 'WORKSTATION', 'NETWORK_DEVICE', 'PRINTER', 'MOBILE_DEVICE', 'OTHER'];
const ASSET_STATUSES: AssetStatus[] = ['ACTIVE', 'INACTIVE', 'RETIRED'];
const PAGE_SIZE = 50;

export function Assets() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [cidrRange, setCidrRange] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetType | ''>('');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | 'new' | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  function load(offset = 0) {
    if (offset > 0) setLoadingMore(true);
    const params = new URLSearchParams();
    if (typeFilter) params.set('assetType', typeFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (debouncedQ) params.set('q', debouncedQ);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    apiGet<{ assets: Asset[]; total: number }>(`/assets?${params.toString()}`)
      .then((res) => {
        setAssets((prev) => (offset > 0 && prev ? [...prev, ...res.assets] : res.assets));
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load assets'))
      .finally(() => setLoadingMore(false));
    apiGet<{ discoveryJobs: DiscoveryJob[] }>('/discovery-jobs')
      .then((res) => setJobs(res.discoveryJobs))
      .catch(() => {});
  }

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter, debouncedQ]);

  // Poll while any job is still running/pending -- discovery is async, the queue
  // does the real work, so this is the simplest way to reflect its progress without
  // wiring up realtime updates (deferred, see docs/ROADMAP.md).
  useEffect(() => {
    const active = jobs.some((j) => j.status === 'PENDING' || j.status === 'RUNNING');
    if (!active) return;
    const id = setInterval(() => load(), 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  async function onSubmitScan(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/discovery-jobs', { cidrRange });
      setCidrRange('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start scan');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveAsset(values: AssetFormValues) {
    if (editingAsset && editingAsset !== 'new') {
      await apiPatch(`/assets/${editingAsset.id}`, values);
    } else {
      await apiPost('/assets', values);
    }
    load();
  }

  async function removeAsset(asset: Asset) {
    if (!confirm(`Delete asset "${asset.name}"? This also removes it from any linked tickets.`)) return;
    try {
      await apiDelete(`/assets/${asset.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete asset');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Assets</h1>
        <button
          onClick={() => setEditingAsset('new')}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New asset
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Discovered via agentless network scans (TCP liveness + SNMP), or added by hand. See
        docs/adr/0002-agentless-discovery.md for how classification works and its limits.
      </p>

      <form onSubmit={onSubmitScan} className="mb-5 flex items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Scan a network range</span>
          <input
            value={cidrRange}
            onChange={(e) => setCidrRange(e.target.value)}
            placeholder="192.168.1.0/24"
            required
            className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg border border-slate-200 px-4 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Start scan
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {jobs.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-400">Recent scans</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-slate-700">{j.cidrRange}</span>
                    <Badge tone={JOB_STATUS_TONE[j.status]} dot>
                      {j.status}
                    </Badge>
                    {j.status === 'FAILED' && j.errorMessage && (
                      <span className="text-rose-600">{j.errorMessage}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-slate-400">
                    <span>{j.discoveredCount} found</span>
                    <span>{j.startedAt ? formatDateTime(j.startedAt) : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <div className="flex w-[260px] items-center gap-2 rounded-[9px] border border-slate-200 bg-white px-3 py-2">
          <SearchIcon width={15} height={15} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, IP, hostname…"
            className="w-full bg-transparent text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as AssetType | '')}
          className="rounded-[7px] border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] text-slate-600"
        >
          <option value="">Any type</option>
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AssetStatus | '')}
          className="rounded-[7px] border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] text-slate-600"
        >
          <option value="">Any status</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {assets && (
          <span className="ml-1 text-[13px] text-slate-400">
            {assets.length} of {total}
          </span>
        )}
      </div>

      {assets === null && <p className="text-sm text-slate-500">Loading…</p>}
      {assets?.length === 0 && <p className="text-sm text-slate-500">No assets here. Add one or run a scan above.</p>}

      {assets && assets.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[2fr_100px_90px_110px_120px_90px_110px_60px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
            <span>Name</span>
            <span>Type</span>
            <span>Status</span>
            <span>IP</span>
            <span>Hostname</span>
            <span>Source</span>
            <span>Last seen</span>
            <span></span>
          </div>
          <div className="divide-y divide-slate-100">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="grid grid-cols-[2fr_100px_90px_110px_120px_90px_110px_60px] items-center gap-3 px-5 py-3 hover:bg-slate-50"
              >
                <Link to={`/assets/${asset.id}`} className="contents">
                  <span className="truncate text-[13.5px] font-semibold text-slate-800">{asset.name}</span>
                  <span className="w-fit">
                    <Badge tone="slate">{asset.assetType}</Badge>
                  </span>
                  <span className="w-fit">
                    <Badge tone={ASSET_STATUS_TONE[asset.status]} dot>
                      {asset.status}
                    </Badge>
                  </span>
                  <span className="truncate text-[12.5px] text-slate-500">{asset.ipAddress ?? '—'}</span>
                  <span className="truncate text-[12.5px] text-slate-500">{asset.hostname ?? '—'}</span>
                  <span className="truncate text-[12px] text-slate-400">{asset.discoverySource}</span>
                  <span className="truncate text-[12px] text-slate-400">
                    {asset.lastSeenAt ? formatDateTime(asset.lastSeenAt) : '—'}
                  </span>
                </Link>
                <div className="text-right text-xs">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setEditingAsset(asset);
                    }}
                    className="mr-2.5 text-slate-400 hover:text-indigo-600"
                  >
                    edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      removeAsset(asset);
                    }}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {assets && assets.length < total && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => load(assets.length)}
            disabled={loadingMore}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-[13px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : `Load more (${total - assets.length} remaining)`}
          </button>
        </div>
      )}

      {editingAsset && (
        <AssetFormModal
          asset={editingAsset === 'new' ? undefined : editingAsset}
          onClose={() => setEditingAsset(null)}
          onSubmit={saveAsset}
        />
      )}
    </div>
  );
}
