import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Asset, DiscoveryJob } from '../lib/types';
import { Badge } from '../components/Badge';
import { AssetFormModal, type AssetFormValues } from '../components/AssetFormModal';
import { formatDateTime } from '../lib/format';

const JOB_STATUS_TONE = {
  PENDING: 'slate',
  RUNNING: 'sky',
  COMPLETED: 'emerald',
  FAILED: 'rose',
} as const;

export function Assets() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [cidrRange, setCidrRange] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | 'new' | null>(null);

  function load() {
    apiGet<{ assets: Asset[] }>('/assets')
      .then((res) => setAssets(res.assets))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load assets'));
    apiGet<{ discoveryJobs: DiscoveryJob[] }>('/discovery-jobs')
      .then((res) => setJobs(res.discoveryJobs))
      .catch(() => {});
  }

  useEffect(load, []);

  // Poll while any job is still running/pending -- discovery is async, the queue
  // does the real work, so this is the simplest way to reflect its progress without
  // wiring up realtime updates (deferred, see docs/ROADMAP.md).
  useEffect(() => {
    const active = jobs.some((j) => j.status === 'PENDING' || j.status === 'RUNNING');
    if (!active) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
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
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Assets</h1>
        <button
          onClick={() => setEditingAsset('new')}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New asset
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Discovered via agentless network scans (TCP liveness + SNMP), or added by hand. See
        docs/adr/0002-agentless-discovery.md for how classification works and its limits.
      </p>

      <form onSubmit={onSubmitScan} className="mb-4 flex items-end gap-2">
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
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Start scan
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {jobs.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-slate-700">Recent scans</h2>
          <table className="w-full max-w-2xl text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="border-b border-slate-200 py-1.5 font-medium">Range</th>
                <th className="border-b border-slate-200 py-1.5 font-medium">Status</th>
                <th className="border-b border-slate-200 py-1.5 font-medium">Found</th>
                <th className="border-b border-slate-200 py-1.5 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="border-b border-slate-100 py-1.5">{j.cidrRange}</td>
                  <td className="border-b border-slate-100 py-1.5">
                    <Badge tone={JOB_STATUS_TONE[j.status]}>{j.status}</Badge>
                  </td>
                  <td className="border-b border-slate-100 py-1.5">{j.discoveredCount}</td>
                  <td className="border-b border-slate-100 py-1.5 text-slate-500">
                    {j.startedAt ? formatDateTime(j.startedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assets === null && <p className="text-sm text-slate-500">Loading…</p>}
      {assets?.length === 0 && <p className="text-sm text-slate-500">No assets yet — add one or run a scan above.</p>}

      {assets && assets.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">IP</th>
                <th className="px-4 py-2 font-medium">Hostname</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((asset) => (
                <tr key={asset.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-900">{asset.name}</td>
                  <td className="px-4 py-2">
                    <Badge tone="slate">{asset.assetType}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={asset.status === 'ACTIVE' ? 'emerald' : asset.status === 'RETIRED' ? 'slate' : 'amber'}>
                      {asset.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{asset.ipAddress ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{asset.hostname ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500">{asset.discoverySource}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {asset.lastSeenAt ? formatDateTime(asset.lastSeenAt) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-xs">
                    <button onClick={() => setEditingAsset(asset)} className="mr-3 text-slate-400 hover:text-indigo-600">
                      edit
                    </button>
                    <button onClick={() => removeAsset(asset)} className="text-slate-400 hover:text-red-600">
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
