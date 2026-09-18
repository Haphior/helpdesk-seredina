import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { CustomFieldDefinition, CustomFieldType } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { ChevronDownIcon, ChevronUpIcon } from '../components/icons';

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
  const [editing, setEditing] = useState<CustomFieldDefinition | null>(null);

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

  async function move(field: CustomFieldDefinition, direction: -1 | 1) {
    if (!fields) return;
    const i = fields.findIndex((f) => f.id === field.id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= fields.length) return;
    const other = fields[j];
    try {
      await Promise.all([
        apiPatch(`/custom-fields/${field.id}`, { sortOrder: other.sortOrder }),
        apiPatch(`/custom-fields/${other.id}`, { sortOrder: field.sortOrder }),
      ]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reorder');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Custom Fields</h1>
        <Button onClick={() => setShowCreate(true)}>New field</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Extra fields shown on every ticket's details panel, beyond status/priority/team/assignee.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {fields === null && <p className="text-sm text-slate-500">Loading…</p>}
      {fields?.length === 0 && <p className="text-sm text-slate-500">No custom fields yet.</p>}

      {fields && fields.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {fields.map((f, i) => (
              <div key={f.id} className="group flex items-center justify-between px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      iconOnly
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${f.label} field up`}
                      onClick={() => move(f, -1)}
                      disabled={i === 0}
                      className="!h-5 !w-5"
                    >
                      <ChevronUpIcon width={12} height={12} />
                    </Button>
                    <Button
                      iconOnly
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${f.label} field down`}
                      onClick={() => move(f, 1)}
                      disabled={i === fields.length - 1}
                      className="!h-5 !w-5"
                    >
                      <ChevronDownIcon width={12} height={12} />
                    </Button>
                  </div>
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
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="slate">{TYPE_LABEL[f.fieldType]}</Badge>
                  <button onClick={() => setEditing(f)} className="text-xs text-slate-400 hover:text-indigo-600">
                    edit
                  </button>
                  <button onClick={() => remove(f)} className="text-xs text-slate-400 hover:text-rose-600">
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showCreate && <CreateFieldModal onClose={() => setShowCreate(false)} onCreated={load} />}
      {editing && <EditFieldModal field={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function RequiredCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
      />
      Required
    </label>
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
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Order number" required />

        <div>
          <Input
            label="Key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="order_number"
            pattern="[a-z][a-z0-9_]*"
            required
          />
          <span className="mt-1 block text-xs text-slate-400">Lowercase, no spaces — used as the storage key.</span>
        </div>

        <Select label="Type" value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}>
          {Object.entries(TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        {fieldType === 'SELECT' && (
          <div>
            <Input label="Options" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Small, Medium, Large" />
            <span className="mt-1 block text-xs text-slate-400">Comma-separated.</span>
          </div>
        )}

        <RequiredCheckbox checked={required} onChange={setRequired} />

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// key and fieldType are intentionally not editable here -- see the comment on
// updateCustomFieldDefinition (apps/api/src/modules/customfields/service.ts)
// for why: both would need a real data migration, not a form field.
function EditFieldModal({
  field,
  onClose,
  onSaved,
}: {
  field: CustomFieldDefinition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [options, setOptions] = useState(field.options.join(', '));
  const [required, setRequired] = useState(field.required);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPatch(`/custom-fields/${field.id}`, {
        label,
        required,
        options:
          field.fieldType === 'SELECT'
            ? options
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
            : undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save custom field');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Edit "${field.label}"`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} required />

        <p className="text-xs text-slate-400">
          Key <code className="rounded bg-slate-100 px-1">{field.key}</code> and type{' '}
          <code className="rounded bg-slate-100 px-1">{field.fieldType}</code> can't change after creation — delete and
          recreate the field if you need a different one.
        </p>

        {field.fieldType === 'SELECT' && (
          <div>
            <Input label="Options" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Small, Medium, Large" />
            <span className="mt-1 block text-xs text-slate-400">Comma-separated.</span>
          </div>
        )}

        <RequiredCheckbox checked={required} onChange={setRequired} />

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
