import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { AssetSummary, Contract, ContractStatus, ContractType } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';

const TYPES: ContractType[] = ['SUPPORT', 'WARRANTY', 'LICENSE', 'LEASE', 'SUBSCRIPTION', 'OTHER'];
const STATUS_FILTERS: ('' | ContractStatus)[] = ['', 'expiring', 'expired', 'active', 'no_end_date'];

export function ContractStatusBadge({ contract }: { contract: Pick<Contract, 'status' | 'daysUntilEnd'> }) {
  const { t } = useTranslation();
  if (contract.status === 'expired') return <Badge tone="rose">{t('contracts.status.expired')}</Badge>;
  if (contract.status === 'expiring') {
    return (
      <Badge tone="amber" dot>
        {t('contracts.status.expiringIn', { count: contract.daysUntilEnd ?? 0 })}
      </Badge>
    );
  }
  if (contract.status === 'active') return <Badge tone="emerald">{t('contracts.status.active')}</Badge>;
  return <Badge tone="slate">{t('contracts.status.no_end_date')}</Badge>;
}

function money(amount: number, currency: string | null, locale: string) {
  if (!currency) return amount.toLocaleString(locale);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toLocaleString(locale)} ${currency}`;
  }
}

/** CMDB → Contracts: support, warranties, licenses, leases -- docs/adr/0062-contracts.md. */
export function Contracts() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('assets:manage');
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [summary, setSummary] = useState<{ expiring: number; expired: number; recurringYearlyCost: { currency: string; amount: number }[] } | null>(null);
  const [status, setStatus] = useState<'' | ContractStatus>('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Contract | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (search.trim()) qs.set('search', search.trim());
    apiGet<{ contracts: Contract[] }>(`/contracts?${qs.toString()}`)
      .then((r) => setContracts(r.contracts))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('contracts.loadFailed')));
    apiGet<typeof summary>('/contracts/summary')
      .then(setSummary)
      .catch(() => {});
  }, [status, search, t]);

  useEffect(() => {
    const handle = setTimeout(load, 200);
    return () => clearTimeout(handle);
  }, [load]);

  async function remove(c: Contract) {
    if (!confirm(t('contracts.confirmDelete', { name: c.name }))) return;
    try {
      await apiDelete(`/contracts/${c.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('contracts.saveFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('contracts.title')}</h1>
        {canManage && <Button onClick={() => setEditing('new')}>{t('contracts.new')}</Button>}
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">{t('contracts.intro')}</p>

      {summary && (
        <div className="mb-4 flex flex-wrap gap-3">
          <Card className="px-4 py-3">
            <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">{t('contracts.summary.expiring')}</p>
            <p className="text-[20px] font-extrabold text-amber-600">{summary.expiring}</p>
          </Card>
          <Card className="px-4 py-3">
            <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">{t('contracts.summary.expired')}</p>
            <p className="text-[20px] font-extrabold text-rose-600">{summary.expired}</p>
          </Card>
          {summary.recurringYearlyCost.map((c) => (
            <Card key={c.currency} className="px-4 py-3">
              <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">{t('contracts.summary.yearlyCost')}</p>
              <p className="text-[20px] font-extrabold text-slate-800">{money(c.amount, c.currency, i18n.language)}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('contracts.searchPlaceholder')}
          className="w-64 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-indigo-400"
        />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${
              status === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s ? t(`contracts.filter.${s}`) : t('contracts.filter.all')}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {contracts === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {contracts?.length === 0 && <p className="text-sm text-slate-500">{t('contracts.empty')}</p>}

      {contracts && contracts.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">{t('contracts.fields.name')}</th>
                <th className="px-5 py-2.5">{t('contracts.fields.type')}</th>
                <th className="px-5 py-2.5">{t('contracts.fields.supplier')}</th>
                <th className="px-5 py-2.5">{t('contracts.fields.endDate')}</th>
                <th className="px-5 py-2.5">{t('contracts.fields.cost')}</th>
                <th className="px-5 py-2.5">{t('contracts.fields.assets')}</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contracts.map((c) => (
                <tr key={c.id} className="align-top hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <span className="font-semibold text-slate-800">{c.name}</span>
                    {c.reference && <p className="text-xs text-slate-400">{c.reference}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {t(`contracts.type.${c.type}`)}
                    {c.seats != null && <p className="text-xs text-slate-400">{t('contracts.seatsCount', { count: c.seats })}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.supplier ?? '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <p className="text-slate-700">{c.endDate ? c.endDate.slice(0, 10) : '—'}</p>
                    <ContractStatusBadge contract={c} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                    {c.cost != null ? money(c.cost, c.currency, i18n.language) : '—'}
                    {c.billingPeriod && <p className="text-xs text-slate-400">{t(`contracts.billing.${c.billingPeriod}`)}</p>}
                  </td>
                  <td className="px-5 py-3">
                    {c.assets.slice(0, 3).map((a) => (
                      <Link key={a.id} to={`/assets/${a.id}`} className="block text-indigo-700 hover:underline">
                        {a.name}
                      </Link>
                    ))}
                    {c.assets.length > 3 && <span className="text-xs text-slate-400">+{c.assets.length - 3}</span>}
                  </td>
                  <td className="space-x-3 whitespace-nowrap px-5 py-3 text-right text-xs">
                    {canManage && (
                      <>
                        <button onClick={() => setEditing(c)} className="text-slate-400 hover:text-indigo-600">
                          {t('contracts.edit')}
                        </button>
                        <button onClick={() => remove(c)} className="text-slate-400 hover:text-rose-600">
                          {t('contracts.delete')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && (
        <ContractModal
          contract={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ContractModal({ contract, onClose, onSaved }: { contract: Contract | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(contract?.name ?? '');
  const [type, setType] = useState<ContractType>(contract?.type ?? 'SUPPORT');
  const [supplier, setSupplier] = useState(contract?.supplier ?? '');
  const [reference, setReference] = useState(contract?.reference ?? '');
  const [startDate, setStartDate] = useState(contract?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(contract?.endDate?.slice(0, 10) ?? '');
  const [notice, setNotice] = useState(String(contract?.renewalNoticeDays ?? 30));
  const [cost, setCost] = useState(contract?.cost != null ? String(contract.cost) : '');
  const [currency, setCurrency] = useState(contract?.currency ?? '');
  const [billingPeriod, setBillingPeriod] = useState(contract?.billingPeriod ?? '');
  const [seats, setSeats] = useState(contract?.seats != null ? String(contract.seats) : '');
  const [notes, setNotes] = useState(contract?.notes ?? '');
  const [assets, setAssets] = useState<{ id: string; name: string }[]>(contract?.assets ?? []);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetResults, setAssetResults] = useState<AssetSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!assetQuery.trim()) {
      setAssetResults([]);
      return;
    }
    const handle = setTimeout(() => {
      apiGet<{ assets: AssetSummary[] }>(`/assets?q=${encodeURIComponent(assetQuery.trim())}&limit=8`)
        .then((r) => setAssetResults(r.assets))
        .catch(() => setAssetResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [assetQuery]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const body = {
      name,
      type,
      supplier: supplier.trim() || null,
      reference: reference.trim() || null,
      startDate: startDate || null,
      endDate: endDate || null,
      renewalNoticeDays: Number(notice) || 0,
      cost: cost.trim() ? Number(cost) : null,
      currency: currency.trim() ? currency.trim().toUpperCase() : null,
      billingPeriod: billingPeriod || null,
      seats: seats.trim() ? Number(seats) : null,
      notes: notes.trim() || null,
      assetIds: assets.map((a) => a.id),
    };
    try {
      if (contract) await apiPatch(`/contracts/${contract.id}`, body);
      else await apiPost('/contracts', body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('contracts.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={contract ? t('contracts.editTitle') : t('contracts.newTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
        <Input label={t('contracts.fields.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-2 gap-2">
          <Select label={t('contracts.fields.type')} value={type} onChange={(e) => setType(e.target.value as ContractType)}>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`contracts.type.${ty}`)}
              </option>
            ))}
          </Select>
          <Input label={t('contracts.fields.supplier')} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>
        <Input label={t('contracts.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          <Input label={t('contracts.fields.startDate')} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label={t('contracts.fields.endDate')} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <Input label={t('contracts.fields.noticeDays')} type="number" min={0} max={365} value={notice} onChange={(e) => setNotice(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Input label={t('contracts.fields.cost')} type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
          <Input label={t('contracts.fields.currency')} value={currency} maxLength={3} placeholder="CLP" onChange={(e) => setCurrency(e.target.value)} />
          <Select label={t('contracts.fields.billing')} value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)}>
            <option value="">—</option>
            <option value="one_time">{t('contracts.billing.one_time')}</option>
            <option value="monthly">{t('contracts.billing.monthly')}</option>
            <option value="yearly">{t('contracts.billing.yearly')}</option>
          </Select>
        </div>
        {type === 'LICENSE' && (
          <Input label={t('contracts.fields.seats')} type="number" min={0} value={seats} onChange={(e) => setSeats(e.target.value)} />
        )}

        <div>
          <p className="mb-1 text-[12.5px] font-semibold text-slate-600">{t('contracts.fields.assets')}</p>
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {assets.map((a) => (
              <span key={a.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[12.5px] text-slate-700">
                {a.name}
                <button type="button" onClick={() => setAssets(assets.filter((x) => x.id !== a.id))} className="text-slate-400 hover:text-rose-600">
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            value={assetQuery}
            onChange={(e) => setAssetQuery(e.target.value)}
            placeholder={t('contracts.assetSearch')}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-indigo-400"
          />
          {assetResults.length > 0 && (
            <div className="mt-1 rounded-lg border border-slate-200">
              {assetResults
                .filter((r) => !assets.some((a) => a.id === r.id))
                .map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setAssets([...assets, { id: r.id, name: r.name }]);
                      setAssetQuery('');
                    }}
                    className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-slate-50"
                  >
                    {r.name}
                  </button>
                ))}
            </div>
          )}
        </div>

        <Textarea label={t('contracts.fields.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        <p className="text-xs text-slate-400">{t('contracts.noKeysHint')}</p>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={saving}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
