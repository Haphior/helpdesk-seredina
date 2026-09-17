import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { AssetSummary, Service } from '../lib/types';
import { Modal } from '../components/Modal';

export function Services() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [allAssets, setAllAssets] = useState<AssetSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [assetToLink, setAssetToLink] = useState<Record<string, string>>({});

  function load() {
    Promise.all([apiGet<{ services: Service[] }>('/services'), apiGet<{ assets: AssetSummary[] }>('/assets')])
      .then(([s, a]) => {
        setServices(s.services);
        setAllAssets(a.assets);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load services'));
  }

  useEffect(load, []);

  async function remove(service: Service) {
    if (!confirm(`Delete "${service.name}"? This only removes the service record and its asset links.`)) return;
    try {
      await apiDelete(`/services/${service.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete service');
    }
  }

  async function linkAsset(serviceId: string) {
    const assetId = assetToLink[serviceId];
    if (!assetId) return;
    try {
      await apiPost(`/services/${serviceId}/assets`, { assetId });
      setAssetToLink((v) => ({ ...v, [serviceId]: '' }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to link asset');
    }
  }

  async function unlinkAsset(serviceId: string, assetId: string) {
    try {
      await apiDelete(`/services/${serviceId}/assets/${assetId}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to unlink asset');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Services</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New service
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Business-facing services — "Email," "Payroll" — and which assets actually underpin them. A ticket linked to one of
        those assets shows which services it affects.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {services === null && <p className="text-sm text-slate-500">Loading…</p>}
      {services?.length === 0 && <p className="text-sm text-slate-500">No services defined yet.</p>}

      {services && services.length > 0 && (
        <div className="flex flex-col gap-3">
          {services.map((service) => (
            <div key={service.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2.5 flex items-center justify-between">
                <div>
                  <div className="text-[14.5px] font-semibold text-slate-800">{service.name}</div>
                  {service.description && <div className="text-[12.5px] text-slate-400">{service.description}</div>}
                </div>
                <button onClick={() => remove(service)} className="text-xs text-slate-400 hover:text-rose-600">
                  delete
                </button>
              </div>

              <div className="mb-2 flex flex-wrap gap-1.5">
                {service.assets.length === 0 && <span className="text-[12.5px] text-slate-400">No assets linked yet.</span>}
                {service.assets.map(({ asset }) => (
                  <span
                    key={asset.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-600"
                  >
                    {asset.name}
                    <button onClick={() => unlinkAsset(service.id, asset.id)} className="text-slate-400 hover:text-rose-600">
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-1.5">
                <select
                  value={assetToLink[service.id] ?? ''}
                  onChange={(e) => setAssetToLink((v) => ({ ...v, [service.id]: e.target.value }))}
                  className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="">Link an asset…</option>
                  {allAssets
                    .filter((a) => !service.assets.some((sa) => sa.asset.id === a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
                <button
                  onClick={() => linkAsset(service.id)}
                  disabled={!assetToLink[service.id]}
                  className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Link
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateServiceModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}

function CreateServiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/services', { name, description: description || undefined });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create service');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New service" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Payroll"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
