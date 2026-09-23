import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet } from '../lib/api';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import type { Asset, AssetModel, AssetStatus, AssetType } from '../lib/types';

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
  modelId: string | null;
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
    modelId: asset?.modelId ?? null,
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
  const { t } = useTranslation();
  const [values, setValues] = useState<AssetFormValues>(() => toFormValues(asset));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [catalogModels, setCatalogModels] = useState<AssetModel[]>([]);

  useEffect(() => {
    apiGet<{ assetModels: AssetModel[] }>('/asset-models')
      .then((res) => setCatalogModels(res.assetModels))
      .catch(() => {}); // catalog picker is a convenience; a load failure shouldn't block editing an asset by hand
  }, []);

  function setField<K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function pickCatalogModel(modelId: string) {
    if (!modelId) {
      setField('modelId', null);
      return;
    }
    const picked = catalogModels.find((m) => m.id === modelId);
    if (!picked) return;
    setValues((v) => ({
      ...v,
      modelId: picked.id,
      assetType: picked.assetType,
      manufacturer: picked.manufacturer.name,
      model: picked.name,
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('assetForm.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={asset ? t('assetForm.edit') : t('assetForm.new')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input label={t('assetForm.name')} value={values.name} onChange={(e) => setField('name', e.target.value)} required />

        <div className="grid grid-cols-2 gap-2">
          <Select label={t('assetForm.type')} value={values.assetType} onChange={(e) => setField('assetType', e.target.value as AssetType)}>
            {ASSET_TYPES.map((o) => (
              <option key={o} value={o}>
                {t(`assetType.${o}`)}
              </option>
            ))}
          </Select>
          <Select label={t('assetForm.status')} value={values.status} onChange={(e) => setField('status', e.target.value as AssetStatus)}>
            {ASSET_STATUSES.map((o) => (
              <option key={o} value={o}>
                {t(`assetStatus.${o}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Input
            label={t('assetForm.ip')}
            value={values.ipAddress ?? ''}
            onChange={(e) => setField('ipAddress', e.target.value || null)}
            placeholder="192.168.1.10"
          />
          <Input label={t('assetForm.mac')} value={values.macAddress ?? ''} onChange={(e) => setField('macAddress', e.target.value || null)} />
        </div>

        <Input label={t('assetForm.hostname')} value={values.hostname ?? ''} onChange={(e) => setField('hostname', e.target.value || null)} />

        {catalogModels.length > 0 && (
          <Select label={t('assetForm.catalogModel')} value={values.modelId ?? ''} onChange={(e) => pickCatalogModel(e.target.value)}>
            <option value="">{t('assetForm.catalogPick')}</option>
            {catalogModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.manufacturer.name} / {m.name}
              </option>
            ))}
          </Select>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Input
            label={t('assetForm.manufacturer')}
            value={values.manufacturer ?? ''}
            onChange={(e) => setField('manufacturer', e.target.value || null)}
          />
          <Input label={t('assetForm.model')} value={values.model ?? ''} onChange={(e) => setField('model', e.target.value || null)} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Input
            label={t('assetForm.serial')}
            value={values.serialNumber ?? ''}
            onChange={(e) => setField('serialNumber', e.target.value || null)}
          />
          <Input
            label={t('assetForm.os')}
            value={values.operatingSystem ?? ''}
            onChange={(e) => setField('operatingSystem', e.target.value || null)}
          />
        </div>

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
