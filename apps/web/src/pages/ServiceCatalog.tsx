import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { CustomFieldDefinition, ServiceCatalogItem } from '../lib/types';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Textarea } from '../components/Textarea';
import { Card } from '../components/Card';

export function ServiceCatalog() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ServiceCatalogItem[] | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ServiceCatalogItem | null>(null);

  function load() {
    Promise.all([
      apiGet<{ items: ServiceCatalogItem[] }>('/service-catalog-items'),
      apiGet<{ customFields: CustomFieldDefinition[] }>('/custom-fields'),
    ])
      .then(([i, cf]) => {
        setItems(i.items);
        setCustomFields(cf.customFields);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('catalog.loadFailed')));
  }

  useEffect(load, []);

  async function remove(item: ServiceCatalogItem) {
    if (!confirm(t('catalog.confirmDelete', { name: item.name }))) return;
    try {
      await apiDelete(`/service-catalog-items/${item.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('catalog.deleteFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('catalog.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('catalog.newItem')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('catalog.intro')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {items === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {items?.length === 0 && <p className="text-sm text-slate-500">{t('catalog.empty')}</p>}

      {items && items.length > 0 && (
        <Card className="overflow-hidden p-0">
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
                      {t('catalog.fields', { count: item.customFieldKeys.length })}
                    </span>
                  )}
                  <button onClick={() => setEditing(item)} className="text-xs text-slate-400 hover:text-indigo-600">
                    {t('catalog.edit')}
                  </button>
                  <button onClick={() => remove(item)} className="text-xs text-slate-400 hover:text-rose-600">
                    {t('catalog.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showCreate && (
        <ItemModal customFields={customFields} onClose={() => setShowCreate(false)} onSaved={load} />
      )}
      {editing && (
        <ItemModal item={editing} customFields={customFields} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}

function ItemModal({
  item,
  customFields,
  onClose,
  onSaved,
}: {
  item?: ServiceCatalogItem;
  customFields: CustomFieldDefinition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [icon, setIcon] = useState(item?.icon ?? '');
  const [selectedKeys, setSelectedKeys] = useState<string[]>(item?.customFieldKeys ?? []);
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
      const data = {
        name,
        description: description || undefined,
        icon: icon || undefined,
        customFieldKeys: selectedKeys,
      };
      if (item) {
        await apiPatch(`/service-catalog-items/${item.id}`, data);
      } else {
        await apiPost('/service-catalog-items', data);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('catalog.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={item ? t('catalog.editTitle', { name: item.name }) : t('catalog.newTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex gap-2">
          <div className="w-16">
            <Input label={t('catalog.icon')} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="💻" className="text-center" />
          </div>
          <div className="flex-1">
            <Input label={t('catalog.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('catalog.namePlaceholder')} required />
          </div>
        </div>

        <Textarea label={t('catalog.description')} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />

        {customFields.length > 0 && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">{t('catalog.fieldsToAsk')}</span>
            <div className="flex flex-col gap-1.5 rounded-md border border-slate-200 p-2">
              {customFields.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-[13px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={selectedKeys.includes(f.key)}
                    onChange={() => toggleKey(f.key)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
