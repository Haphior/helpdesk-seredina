import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { AssetModel, AssetType, Manufacturer } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';

const ASSET_TYPES: AssetType[] = ['SERVER', 'WORKSTATION', 'NETWORK_DEVICE', 'PRINTER', 'MOBILE_DEVICE', 'OTHER'];

export function EquipmentCatalog() {
  const [manufacturers, setManufacturers] = useState<Manufacturer[] | null>(null);
  const [models, setModels] = useState<AssetModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    Promise.all([
      apiGet<{ manufacturers: Manufacturer[] }>('/manufacturers'),
      apiGet<{ assetModels: AssetModel[] }>('/asset-models'),
    ])
      .then(([m, am]) => {
        setManufacturers(m.manufacturers);
        setModels(am.assetModels);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load equipment catalog'));
  }

  useEffect(load, []);

  async function removeModel(model: AssetModel) {
    if (!confirm(`Delete model "${model.name}"? Assets linked to it keep their data, just lose the catalog link.`)) return;
    try {
      await apiDelete(`/asset-models/${model.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete model');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Equipment Catalog</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New model
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Manufacturer/model reference list — pick one when adding an asset instead of retyping specs every time.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {models === null && <p className="text-sm text-slate-500">Loading…</p>}
      {models?.length === 0 && <p className="text-sm text-slate-500">No models cataloged yet.</p>}

      {models && models.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {models.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-slate-800">
                    {m.manufacturer.name} <span className="text-slate-400">/</span> {m.name}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="slate">{m.assetType}</Badge>
                  <button onClick={() => removeModel(m)} className="text-xs text-slate-400 hover:text-rose-600">
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && manufacturers && (
        <CreateModelModal manufacturers={manufacturers} onClose={() => setShowCreate(false)} onCreated={load} />
      )}
    </div>
  );
}

function CreateModelModal({
  manufacturers,
  onClose,
  onCreated,
}: {
  manufacturers: Manufacturer[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [manufacturerId, setManufacturerId] = useState(manufacturers[0]?.id ?? '__new__');
  const [newManufacturerName, setNewManufacturerName] = useState('');
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState<AssetType>('WORKSTATION');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const creatingNewManufacturer = manufacturerId === '__new__';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let resolvedManufacturerId = manufacturerId;
      if (creatingNewManufacturer) {
        const created = await apiPost<Manufacturer>('/manufacturers', { name: newManufacturerName });
        resolvedManufacturerId = created.id;
      }
      await apiPost('/asset-models', { manufacturerId: resolvedManufacturerId, name, assetType });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create model');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New equipment model" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Manufacturer</span>
          <select
            value={manufacturerId}
            onChange={(e) => setManufacturerId(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {manufacturers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="__new__">+ New manufacturer…</option>
          </select>
        </label>

        {creatingNewManufacturer && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">New manufacturer name</span>
            <input
              value={newManufacturerName}
              onChange={(e) => setNewManufacturerName(e.target.value)}
              placeholder="Dell"
              required
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Model name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="OptiPlex 7090"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Default type</span>
          <select
            value={assetType}
            onChange={(e) => setAssetType(e.target.value as AssetType)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || (creatingNewManufacturer && !newManufacturerName.trim())}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
