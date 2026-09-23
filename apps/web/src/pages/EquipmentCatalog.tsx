import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { AssetModel, AssetType, Manufacturer } from '../lib/types';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';

const ASSET_TYPES: AssetType[] = ['SERVER', 'WORKSTATION', 'NETWORK_DEVICE', 'PRINTER', 'MOBILE_DEVICE', 'OTHER'];

export function EquipmentCatalog() {
  const { t } = useTranslation();
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
      .catch((err) => setError(err instanceof ApiError ? err.message : t('equipment.loadFailed')));
  }

  useEffect(load, []);

  async function removeModel(model: AssetModel) {
    if (!confirm(t('equipment.confirmDelete', { name: model.name }))) return;
    try {
      await apiDelete(`/asset-models/${model.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('equipment.deleteFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('equipment.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('equipment.newModel')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('equipment.intro')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {models === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {models?.length === 0 && <p className="text-sm text-slate-500">{t('equipment.empty')}</p>}

      {models && models.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {models.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-slate-800">
                    {m.manufacturer.name} <span className="text-slate-400">/</span> {m.name}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="slate">{t(`assetType.${m.assetType}`)}</Badge>
                  <button onClick={() => removeModel(m)} className="text-xs text-slate-400 hover:text-rose-600">
                    {t('equipment.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
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
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('equipment.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('equipment.newTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Select label={t('equipment.manufacturer')} value={manufacturerId} onChange={(e) => setManufacturerId(e.target.value)}>
          {manufacturers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value="__new__">{t('equipment.newManufacturerOption')}</option>
        </Select>

        {creatingNewManufacturer && (
          <Input
            label={t('equipment.newManufacturerName')}
            value={newManufacturerName}
            onChange={(e) => setNewManufacturerName(e.target.value)}
            placeholder="Dell"
            required
          />
        )}

        <Input label={t('equipment.modelName')} value={name} onChange={(e) => setName(e.target.value)} placeholder="OptiPlex 7090" required />

        <Select label={t('equipment.defaultType')} value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>
          {ASSET_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`assetType.${ty}`)}
            </option>
          ))}
        </Select>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting} disabled={creatingNewManufacturer && !newManufacturerName.trim()}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
