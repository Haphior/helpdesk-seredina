import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { CustomFieldDefinition, ServiceCatalogItem } from '../lib/types';
import { Modal } from '../components/Modal';

export function ServiceCatalog() {
  const [items, setItems] = useState<ServiceCatalogItem[] | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    Promise.all([
      apiGet<{ items: ServiceCatalogItem[] }>('/service-catalog-items'),
      apiGet<{ customFields: CustomFieldDefinition[] }>('/custom-fields'),
    ])
      .then(([i, cf]) => {
        setItems(i.items);
        setCustomFields(cf.customFields);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load the service catalog'));
  }

  useEffect(load, []);

  async function remove(item: ServiceCatalogItem) {
    if (!confirm(`Delete "${item.name}"? Tickets already created from it are kept.`)) return;
    try {
      await apiDelete(`/service-catalog-items/${item.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete item');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Service Catalog</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New item
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Requestable things — "new laptop," "VPN access," "onboard a contractor." Agents request one from the Tickets page,
        which creates a ticket pre-filled with the fields you choose here.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {items === null && <p className="text-sm text-slate-500">Loading…</p>}
      {items?.length === 0 && <p className="text-sm text-slate-500">No catalog items yet.</p>}

      {items && items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-[20px]">{item.icon || '📋'}</span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-slate-800">{item.name}</div>
                    {item.description && <div className="truncate text-[12.5px] text-slate-400">{item.description}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {item.customFieldKeys.length > 0 && (
                    <span className="text-[12px] text-slate-400">
                      {item.customFieldKeys.length} field{item.customFieldKeys.length === 1 ? '' : 's'}
                    </span>
                  )}
                  <button onClick={() => remove(item)} className="text-xs text-slate-400 hover:text-rose-600">
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateItemModal customFields={customFields} onClose={() => setShowCreate(false)} onCreated={load} />
      )}
    </div>
  );
}

function CreateItemModal({
  customFields,
  onClose,
  onCreated,
}: {
  customFields: CustomFieldDefinition[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleKey(key: string) {
    setSelectedKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/service-catalog-items', {
        name,
        description: description || undefined,
        icon: icon || undefined,
        customFieldKeys: selectedKeys,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create item');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New catalog item" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex gap-2">
          <label className="block w-16 text-sm">
            <span className="mb-1 block font-medium text-slate-700">Icon</span>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="💻"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm"
            />
          </label>
          <label className="block flex-1 text-sm">
            <span className="mb-1 block font-medium text-slate-700">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New laptop"
              required
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        {customFields.length > 0 && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Fields to ask for</span>
            <div className="flex flex-col gap-1.5 rounded-md border border-slate-200 p-2">
              {customFields.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={selectedKeys.includes(f.key)} onChange={() => toggleKey(f.key)} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        )}

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
