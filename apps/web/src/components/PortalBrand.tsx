import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import type { TenantBranding } from '../lib/types';
import { Logo } from './Logo';

// The self-service portal (PublicKb/PublicKbArticle/PublicStatus) is the one
// surface a tenant's own customers see -- unlike the internal admin console
// (ADR 0042's "One Accent Rule" keeps that Seredina-branded), a tenant may
// replace the logo and wordmark color here with their own. No branding set
// (the common case) falls back to Seredina's own mark, unchanged.
export function PortalBrand({ tenantSlug, title }: { tenantSlug: string | undefined; title: string }) {
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    if (!tenantSlug) return;
    apiGet<TenantBranding>(`/public/${tenantSlug}/branding`)
      .then(setBranding)
      .catch(() => setBranding(null));
  }, [tenantSlug]);

  const showCustomLogo = branding?.logoUrl && !logoFailed;

  return (
    <div className="mb-8 flex items-center gap-2.5">
      {showCustomLogo ? (
        <img
          src={branding.logoUrl!}
          alt=""
          className="h-7 w-7 rounded object-contain"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <Logo size={28} />
      )}
      <span
        className="text-[15px] font-bold text-slate-900"
        style={branding?.accentColor ? { color: branding.accentColor } : undefined}
      >
        {title}
      </span>
    </div>
  );
}
