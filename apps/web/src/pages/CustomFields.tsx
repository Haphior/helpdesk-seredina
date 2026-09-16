import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { CustomFieldDefinition, CustomFieldType } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';

const TYPE_LABEL: Record<CustomFieldType, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  BOOLEAN: 'Yes/No',
  DATE: 'Date',
  SELECT: 'Select',
};

export function CustomFields() {
  const [fields, setFields] = useState<CustomFieldDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    apiGet<{ customFields: CustomFieldDefinition[] }>('/custom-fields')
      .then((res) => setFields(res.customFields))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load custom fields'));
  }

  useEffect(load, []);

  async function remove(field: CustomFieldDefinition) {
    if (!confirm(`Delete custom field "${field.label}"? Existing ticket values for it are kept but hidden.`)) return;
    try {
      await apiDelete(`/custom-fields/${field.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete custom field');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Custom Fields</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          New field
        </button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Extra fields shown on every ticket's details panel, beyond status/priority/team/assignee.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {fields === null && <p className="text-sm text-slate-500">Loading…</p>}
      {fields?.length === 0 && <p className="text-sm text-slate-500">No custom fields yet.</p>}

      {fields && fields.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {fields.map((f) => (
              <div key={f.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-slate-800">{f.label}</span>
                    {f.required && <Badge tone="rose">required</Badge>}
                  </div>
                  <div className="text-[12.5px] text-slate-400">
                    <code className="rounded bg-slate-100 px-1">{f.key}</code>
                    {f.fieldType === 'SELECT' && f.options.length > 0 && <span> · {f.options.join(', ')}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="slate">{TYPE_LABEL[f.fieldType]}</Badge>
                  <button onClick={() => remove(f)} className="text-xs text-slate-400 hover:text-rose-600">
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && <CreateFieldModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}

function CreateFieldModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<CustomFieldType>('TEXT');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/custom-fields', {
        key,
        label,
        fieldType,
        required,
        options:
          fieldType === 'SELECT'
            ? options
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
            : undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create custom field');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New custom field" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Order number"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Key</span>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="order_number"
            pattern="[a-z][a-z0-9_]*"
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-400">Lowercase, no spaces — used as the storage key.</span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Type</span>
          <select
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {fieldType === 'SELECT' && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Options</span>
            <input
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="Small, Medium, Large"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <span className="mt-1 block text-xs text-slate-400">Comma-separated.</span>
          </label>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
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
