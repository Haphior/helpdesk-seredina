import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, ApiError } from '../lib/api';
import type { AssetDetail as AssetDetailType } from '../lib/types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { AssetFormModal, type AssetFormValues } from '../components/AssetFormModal';
import { BackArrowIcon } from '../components/icons';
import { formatDateTime } from '../lib/format';

const STATUS_TONE = { ACTIVE: 'emerald', RETIRED: 'slate', INACTIVE: 'amber' } as const;

export function AssetDetail() {
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
      setError(err instanceof ApiError ? err.message : 'Failed to load asset');
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
    if (!confirm(`Delete asset "${asset.name}"? This also removes it from any linked tickets.`)) return;
    try {
      await apiDelete(`/assets/${id}`);
      navigate('/assets');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete asset');
    }
  }

  if (error && !asset) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!asset) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="px-9 py-7">
      <Link to="/assets" className="mb-3.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-600">
        <BackArrowIcon width={15} height={15} />
        Assets
      </Link>

      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="mb-1.5 text-[22px] font-extrabold tracking-tight text-slate-900">{asset.name}</h1>
          <div className="flex items-center gap-2">
            <Badge tone="slate">{asset.assetType}</Badge>
            <Badge tone={STATUS_TONE[asset.status]} dot>
              {asset.status}
            </Badge>
            <span className="text-[12.5px] text-slate-400">via {asset.discoverySource}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="dangerOutline" onClick={removeAsset}>
            Delete
          </Button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

      <div className="grid grid-cols-[1fr_280px] gap-5">
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-slate-400">Specs</h2>
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <Spec label="IP address" value={asset.ipAddress} />
              <Spec label="MAC address" value={asset.macAddress} />
              <Spec label="Hostname" value={asset.hostname} />
              <Spec label="Serial number" value={asset.serialNumber} />
              <Spec label="Manufacturer" value={asset.manufacturer} />
              <Spec label="Model" value={asset.model} />
              <Spec label="Operating system" value={asset.operatingSystem} />
              <Spec label="Last seen" value={asset.lastSeenAt ? formatDateTime(asset.lastSeenAt) : null} />
            </dl>
            {asset.snmpSysDescr && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">SNMP sysDescr</div>
                <p className="text-[12.5px] text-slate-500">{asset.snmpSysDescr}</p>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">
              Linked tickets ({asset.tickets.length})
            </h2>
            {asset.tickets.length === 0 ? (
              <p className="text-[13px] text-slate-400">No tickets reference this asset yet.</p>
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

        <Card>
          <h2 className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">
            Services underpinned ({asset.services.length})
          </h2>
          {asset.services.length === 0 ? (
            <p className="text-[13px] text-slate-400">
              Not linked to any business service yet — manage this from the Services page.
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
