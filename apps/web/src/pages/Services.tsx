import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { AssetSummary, Service } from '../lib/types';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';
import { Card } from '../components/Card';

interface Me {
  tenantSlug: string;
}

export function Services() {
  const { t } = useTranslation();
  const [services, setServices] = useState<Service[] | null>(null);
  const [allAssets, setAllAssets] = useState<AssetSummary[]>([]);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [assetToLink, setAssetToLink] = useState<Record<string, string>>({});

  function load() {
    // limit=200 (the max) -- feeds the "link an asset" picker below, which
    // needs the whole list. See the identical note in TicketDetail.tsx.
    Promise.all([apiGet<{ services: Service[] }>('/services'), apiGet<{ assets: AssetSummary[] }>('/assets?limit=200')])
      .then(([s, a]) => {
        setServices(s.services);
        setAllAssets(a.assets);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('services.loadFailed')));
  }

  useEffect(() => {
    load();
    apiGet<Me>('/auth/me')
      .then((me) => setTenantSlug(me.tenantSlug))
      .catch(() => {});
  }, []);

  async function remove(service: Service) {
    if (!confirm(t('services.confirmDelete', { name: service.name }))) return;
    try {
      await apiDelete(`/services/${service.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('services.deleteFailed'));
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
      setError(err instanceof ApiError ? err.message : t('services.linkFailed'));
    }
  }

  async function unlinkAsset(serviceId: string, assetId: string) {
    try {
      await apiDelete(`/services/${serviceId}/assets/${assetId}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('services.unlinkFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('services.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('services.new')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        {t('services.introBefore')}{' '}
        {tenantSlug ? <code className="rounded bg-slate-100 px-1">/status/{tenantSlug}</code> : t('services.yourStatusPage')} —{' '}
        {t('services.introAfter')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {services === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {services?.length === 0 && <p className="text-sm text-slate-500">{t('services.empty')}</p>}

      {services && services.length > 0 && (
        <div className="flex flex-col gap-3">
          {services.map((service) => (
            <Card key={service.id}>
              <div className="mb-2.5 flex items-center justify-between">
                <div>
                  <div className="text-[14.5px] font-semibold text-slate-800">{service.name}</div>
                  {service.description && <div className="text-[12.5px] text-slate-400">{service.description}</div>}
                </div>
                <button onClick={() => remove(service)} className="text-xs text-slate-400 hover:text-rose-600">
                  {t('services.delete')}
                </button>
              </div>

              <div className="mb-2 flex flex-wrap gap-1.5">
                {service.assets.length === 0 && <span className="text-[12.5px] text-slate-400">{t('services.noAssets')}</span>}
                {service.assets.map(({ asset }) => (
                  <span
                    key={asset.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-600"
                  >
                    {asset.name}
                    <button
                      onClick={() => unlinkAsset(service.id, asset.id)}
                      aria-label={t('services.unlinkAria', { asset: asset.name, service: service.name })}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-1.5">
                <div className="flex-1">
                  <Select
                    hideLabel
                    aria-label={t('services.linkAria', { service: service.name })}
                    value={assetToLink[service.id] ?? ''}
                    onChange={(e) => setAssetToLink((v) => ({ ...v, [service.id]: e.target.value }))}
                  >
                    <option value="">{t('services.linkPlaceholder')}</option>
                    {allAssets
                      .filter((a) => !service.assets.some((sa) => sa.asset.id === a.id))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <Button size="sm" onClick={() => linkAsset(service.id)} disabled={!assetToLink[service.id]}>
                  {t('services.link')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && <CreateServiceModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}

function CreateServiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('services.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('services.new')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Input label={t('services.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('services.namePlaceholder')} required />

        <Textarea label={t('services.description')} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />

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
