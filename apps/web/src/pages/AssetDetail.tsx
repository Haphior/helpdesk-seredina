import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, ApiError } from '../lib/api';
import type { AssetDetail as AssetDetailType, Contract } from '../lib/types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { AssetFormModal, type AssetFormValues } from '../components/AssetFormModal';
import { BackArrowIcon } from '../components/icons';
import { formatDateTime } from '../lib/format';
import { ContractStatusBadge } from './Contracts';

const STATUS_TONE = { ACTIVE: 'emerald', RETIRED: 'slate', INACTIVE: 'amber' } as const;

export function AssetDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [asset, setAsset] = useState<AssetDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setAsset(await apiGet<AssetDetailType>(`/assets/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('assetDetail.loadFailed'));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveAsset(values: AssetFormValues) {
    if (!id) return;
    await apiPatch(`/assets/${id}`, values);
    await load();
  }

  async function removeAsset() {
    if (!asset || !id) return;
    if (!confirm(t('assetDetail.confirmDelete', { name: asset.name }))) return;
    try {
      await apiDelete(`/assets/${id}`);
      navigate('/assets');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('assetDetail.deleteFailed'));
    }
  }

  if (error && !asset) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!asset) return <div className="p-6 text-sm text-slate-500">{t('common.loading')}</div>;

  return (
    <div className="px-9 py-7">
      <Link to="/assets" className="mb-3.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-600">
        <BackArrowIcon width={15} height={15} />
        {t('assets.title')}
      </Link>

      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="mb-1.5 text-[22px] font-extrabold tracking-tight text-slate-900">{asset.name}</h1>
          <div className="flex items-center gap-2">
            <Badge tone="slate">{t(`assetType.${asset.assetType}`)}</Badge>
            <Badge tone={STATUS_TONE[asset.status]} dot>
              {t(`assetStatus.${asset.status}`)}
            </Badge>
            <span className="text-[12.5px] text-slate-400">{t('assetDetail.via', { source: asset.discoverySource })}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('assetDetail.edit')}
          </Button>
          <Button variant="dangerOutline" onClick={removeAsset}>
            {t('assetDetail.delete')}
          </Button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

      <div className="grid grid-cols-[1fr_280px] gap-5">
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-slate-400">{t('assetDetail.specs')}</h2>
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <Spec label={t('assetDetail.ip')} value={asset.ipAddress} />
              <Spec label={t('assetDetail.mac')} value={asset.macAddress} />
              <Spec label={t('assetDetail.hostname')} value={asset.hostname} />
              <Spec label={t('assetDetail.serial')} value={asset.serialNumber} />
              <Spec label={t('assetDetail.manufacturer')} value={asset.manufacturer} />
              <Spec label={t('assetDetail.model')} value={asset.model} />
              <Spec label={t('assetDetail.os')} value={asset.operatingSystem} />
              <Spec label={t('assetDetail.lastSeen')} value={asset.lastSeenAt ? formatDateTime(asset.lastSeenAt) : null} />
            </dl>
            {asset.snmpSysDescr && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">SNMP sysDescr</div>
                <p className="text-[12.5px] text-slate-500">{asset.snmpSysDescr}</p>
              </div>
            )}
          </Card>

          {asset.discoverySource === 'AGENT' && (
            <Card>
              <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-slate-400">{t('assetDetail.agentInventory')}</h2>
              <dl className="grid grid-cols-2 gap-3 text-[13px]">
                <Spec label="CPU" value={asset.cpuModel} />
                <Spec label={t('assetDetail.memory')} value={asset.memoryTotalMb ? `${(asset.memoryTotalMb / 1024).toFixed(1)} GB` : null} />
                <Spec label={t('assetDetail.osVersion')} value={asset.osVersion} />
                <Spec
                  label={t('assetDetail.diskEncryption')}
                  value={asset.diskEncrypted === null ? null : asset.diskEncrypted ? t('assetDetail.enabled') : t('assetDetail.disabled')}
                />
                <Spec label={t('assetDetail.antivirus')} value={asset.antivirusStatus} />
                <Spec
                  label={t('assetDetail.installedPackages')}
                  value={asset.installedPackages ? t('assetDetail.packages', { count: asset.installedPackages.length }) : null}
                />
              </dl>
              {asset.diskSummary && asset.diskSummary.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">{t('assetDetail.disks')}</div>
                  <div className="flex flex-col gap-1">
                    {asset.diskSummary.map((disk, i) => (
                      <div key={i} className="flex justify-between text-[12.5px] text-slate-600">
                        <span>{disk.mount}</span>
                        <span className="text-slate-400">
                          {t('assetDetail.diskFree', { free: disk.freeGb.toFixed(1), total: disk.totalGb.toFixed(1) })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card>
            <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">
              {t('assetDetail.linkedTickets', { count: asset.tickets.length })}
            </h2>
            {asset.tickets.length === 0 ? (
              <p className="text-[13px] text-slate-400">{t('assetDetail.noTickets')}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {asset.tickets.map(({ ticket }) => (
                  <Link
                    key={ticket.id}
                    to={`/tickets/${ticket.id}`}
                    className="block rounded-md bg-slate-50 px-2.5 py-1.5 text-[13px] font-medium text-indigo-700 hover:underline"
                  >
                    #{ticket.number} {ticket.subject}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
        <AssetContracts assetId={asset.id} />

        <Card>
          <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">
            {t('assetDetail.services', { count: asset.services.length })}
          </h2>
          {asset.services.length === 0 ? (
            <p className="text-[13px] text-slate-400">
              {t('assetDetail.noServices')}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {asset.services.map((s) => (
                <Link
                  key={s.id}
                  to="/services"
                  className="block rounded-md bg-slate-50 px-2.5 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  {s.name}
                </Link>
              ))}
            </div>
          )}
        </Card>
        </div>
      </div>

      {editing && <AssetFormModal asset={asset} onClose={() => setEditing(false)} onSubmit={saveAsset} />}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-700">{value ?? '—'}</div>
    </div>
  );
}

/** Contracts, warranties and licenses covering this asset (docs/adr/0062-contracts.md). */
function AssetContracts({ assetId }: { assetId: string }) {
  const { t } = useTranslation();
  const [contracts, setContracts] = useState<Contract[] | null>(null);

  useEffect(() => {
    apiGet<{ contracts: Contract[] }>(`/contracts?assetId=${assetId}`)
      .then((r) => setContracts(r.contracts))
      .catch(() => setContracts([]));
  }, [assetId]);

  return (
    <Card>
      <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">
        {t('contracts.onAsset', { count: contracts?.length ?? 0 })}
      </h2>
      {contracts === null ? null : contracts.length === 0 ? (
        <p className="text-[13px] text-slate-400">
          {t('contracts.noneOnAsset')}{' '}
          <Link to="/contracts" className="text-indigo-600 hover:underline">
            {t('contracts.title')}
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {contracts.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[13px]">
              <span>
                <span className="font-medium text-slate-800">{c.name}</span>
                <span className="text-slate-400">
                  {' '}
                  · {t(`contracts.type.${c.type}`)}
                  {c.endDate ? ` · ${c.endDate.slice(0, 10)}` : ''}
                </span>
              </span>
              <ContractStatusBadge contract={c} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
