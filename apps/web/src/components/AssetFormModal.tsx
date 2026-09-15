import { useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import type { Asset, AssetStatus, AssetType } from '../lib/types';

const ASSET_TYPES: AssetType[] = ['SERVER', 'WORKSTATION', 'NETWORK_DEVICE', 'PRINTER', 'MOBILE_DEVICE', 'OTHER'];
const ASSET_STATUSES: AssetStatus[] = ['ACTIVE', 'INACTIVE', 'RETIRED'];

export interface AssetFormValues {
  name: string;
  assetType: AssetType;
  status: AssetStatus;
  ipAddress: string | null;
  macAddress: string | null;
  hostname: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  operatingSystem: string | null;
}

function toFormValues(asset?: Asset): AssetFormValues {
  return {
    name: asset?.name ?? '',
    assetType: asset?.assetType ?? 'OTHER',
    status: asset?.status ?? 'ACTIVE',
    ipAddress: asset?.ipAddress ?? null,
    macAddress: asset?.macAddress ?? null,
    hostname: asset?.hostname ?? null,
    serialNumber: asset?.serialNumber ?? null,
    manufacturer: asset?.manufacturer ?? null,
    model: asset?.model ?? null,
    operatingSystem: asset?.operatingSystem ?? null,
  };
}

export function AssetFormModal({
  asset,
  onClose,
  onSubmit,
}: {
  asset?: Asset;
  onClose: () => void;
  onSubmit: (values: AssetFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<AssetFormValues>(() => toFormValues(asset));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save asset');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={asset ? 'Edit asset' : 'New asset'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <TextField label="Name" value={values.name} onChange={(v) => setField('name', v)} required />

        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Type"
            value={values.assetType}
            onChange={(v) => setField('assetType', v as AssetType)}
            options={ASSET_TYPES}
          />
          <SelectField
            label="Status"
            value={values.status}
            onChange={(v) => setField('status', v as AssetStatus)}
            options={ASSET_STATUSES}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="IP address"
            value={values.ipAddress ?? ''}
            onChange={(v) => setField('ipAddress', v || null)}
            placeholder="192.168.1.10"
          />
          <TextField
            label="MAC address"
            value={values.macAddress ?? ''}
            onChange={(v) => setField('macAddress', v || null)}
          />
        </div>

        <TextField
          label="Hostname"
          value={values.hostname ?? ''}
          onChange={(v) => setField('hostname', v || null)}
        />

        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Manufacturer"
            value={values.manufacturer ?? ''}
            onChange={(v) => setField('manufacturer', v || null)}
          />
          <TextField label="Model" value={values.model ?? ''} onChange={(v) => setField('model', v || null)} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Serial number"
            value={values.serialNumber ?? ''}
            onChange={(v) => setField('serialNumber', v || null)}
          />
          <TextField
            label="Operating system"
            value={values.operatingSystem ?? ''}
            onChange={(v) => setField('operatingSystem', v || null)}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

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

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
