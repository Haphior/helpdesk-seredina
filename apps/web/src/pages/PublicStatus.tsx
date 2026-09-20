import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, ApiError } from '../lib/api';
import type { PublicServiceStatusLevel, PublicStatusPage } from '../lib/types';
import { PortalBrand } from '../components/PortalBrand';
import { Card } from '../components/Card';

const OVERALL_COPY: Record<PublicServiceStatusLevel, string> = {
  operational: 'All systems operational',
  degraded: 'Some systems experiencing degraded performance',
  outage: 'Major outage affecting one or more systems',
};

const OVERALL_CLASS: Record<PublicServiceStatusLevel, string> = {
  operational: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  degraded: 'bg-amber-50 text-amber-700 border-amber-200',
  outage: 'bg-rose-50 text-rose-700 border-rose-200',
};

const DOT_CLASS: Record<PublicServiceStatusLevel, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  outage: 'bg-rose-500',
};

const STATUS_LABEL: Record<PublicServiceStatusLevel, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  outage: 'Outage',
};

export function PublicStatus() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [page, setPage] = useState<PublicStatusPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantSlug) return;
    apiGet<PublicStatusPage>(`/public/${tenantSlug}/status`)
      .then(setPage)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load status'));
  }, [tenantSlug]);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <PortalBrand tenantSlug={tenantSlug} title="System Status" />

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {page === null && !error && <p className="text-sm text-slate-500">Loading…</p>}

        {page && (
          <>
            <div className={`mb-6 rounded-xl border px-5 py-4 text-[14.5px] font-semibold ${OVERALL_CLASS[page.overall]}`}>
              {OVERALL_COPY[page.overall]}
            </div>

            {page.services.length === 0 ? (
              <p className="text-sm text-slate-500">No services are published on this status page yet.</p>
            ) : (
              <Card className="overflow-hidden p-0">
                <div className="divide-y divide-slate-100">
                  {page.services.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-5 py-4">
                      <span className="text-[14.5px] font-medium text-slate-800">{s.name}</span>
                      <span className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                        <span className={`h-2 w-2 rounded-full ${DOT_CLASS[s.status]}`} />
                        {STATUS_LABEL[s.status]}
                        {s.openIncidents > 0 && (
                          <span className="text-slate-400">
                            ({s.openIncidents} active incident{s.openIncidents === 1 ? '' : 's'})
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
