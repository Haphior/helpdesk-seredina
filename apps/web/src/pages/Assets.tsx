import { useEffect, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Asset, AssetStatus, AssetType, DiscoveryJob } from '../lib/types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
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
  const { t } = useTranslation();
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  // Server-side scans are self-hosted only (docs/adr/0052-agent-based-discovery.md);
  // null until the API says, so the form never flashes up in cloud mode.
  const [scanEnabled, setScanEnabled] = useState<boolean | null>(null);
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
      .catch((err) => setError(err instanceof ApiError ? err.message : t('assets.loadFailed')))
      .finally(() => setLoadingMore(false));
    apiGet<{ discoveryJobs: DiscoveryJob[]; scanEnabled: boolean }>('/discovery-jobs')
      .then((res) => {
        setJobs(res.discoveryJobs);
        setScanEnabled(res.scanEnabled);
      })
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
      setError(err instanceof ApiError ? err.message : t('assets.scanFailed'));
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
    if (!confirm(t('assets.confirmDelete', { name: asset.name }))) return;
    try {
      await apiDelete(`/assets/${asset.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('assets.deleteFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('assets.title')}</h1>
        <Button onClick={() => setEditingAsset('new')}>{t('assetForm.new')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        <Trans
          i18nKey={scanEnabled ? 'assets.introWithScan' : 'assets.intro'}
          components={{ devices: <Link to="/devices" className="font-medium text-slate-700 underline" /> }}
        />
      </p>

      {scanEnabled && (
        <form onSubmit={onSubmitScan} className="mb-5 flex items-end gap-2">
          <div className="w-64">
            <Input
              label={t('assets.scanRange')}
              value={cidrRange}
              onChange={(e) => setCidrRange(e.target.value)}
              placeholder="192.168.1.0/24"
              required
            />
          </div>
          <Button type="submit" variant="secondary" isLoading={submitting}>
            {t('assets.startScan')}
          </Button>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {jobs.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-400">{t('assets.recentScans')}</h2>
          <Card className="overflow-hidden p-0">
            <div className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-slate-700">{j.cidrRange}</span>
                    <Badge tone={JOB_STATUS_TONE[j.status]} dot>
                      {t(`assets.jobStatus.${j.status}`)}
                    </Badge>
                    {j.status === 'FAILED' && j.errorMessage && (
                      <span className="text-rose-600">{j.errorMessage}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-slate-400">
                    <span>{t('assets.found', { count: j.discoveredCount })}</span>
                    <span>{j.startedAt ? formatDateTime(j.startedAt) : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <div className="w-[260px]">
          <Input
            hideLabel
            aria-label={t('assets.search')}
            icon={<SearchIcon width={15} height={15} />}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('assets.searchPlaceholder')}
          />
        </div>
        <div className="w-[140px]">
          <Select
            hideLabel
            aria-label={t('assets.filterType')}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as AssetType | '')}
          >
            <option value="">{t('assets.anyType')}</option>
            {ASSET_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`assetType.${ty}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[140px]">
          <Select
            hideLabel
            aria-label={t('assets.filterStatus')}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AssetStatus | '')}
          >
            <option value="">{t('assets.anyStatus')}</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`assetStatus.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        {assets && (
          <span className="ml-1 text-[13px] text-slate-400">
            {t('assets.countOf', { shown: assets.length, total })}
          </span>
        )}
      </div>

      {assets === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {assets?.length === 0 && <p className="text-sm text-slate-500">{t('assets.empty')}</p>}

      {assets && assets.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-[2fr_100px_90px_110px_120px_90px_110px_60px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
            <span>{t('assets.col.name')}</span>
            <span>{t('assets.col.type')}</span>
            <span>{t('assets.col.status')}</span>
            <span>IP</span>
            <span>{t('assets.col.hostname')}</span>
            <span>{t('assets.col.source')}</span>
            <span>{t('assets.col.lastSeen')}</span>
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
                    <Badge tone="slate">{t(`assetType.${asset.assetType}`)}</Badge>
                  </span>
                  <span className="w-fit">
                    <Badge tone={ASSET_STATUS_TONE[asset.status]} dot>
                      {t(`assetStatus.${asset.status}`)}
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
                    {t('assets.edit')}
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      removeAsset(asset);
                    }}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    {t('assets.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {assets && assets.length < total && (
        <div className="flex justify-center pt-4">
          <Button variant="secondary" onClick={() => load(assets.length)} isLoading={loadingMore}>
            {loadingMore ? t('common.loading') : t('assets.loadMore', { count: total - assets.length })}
          </Button>
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
