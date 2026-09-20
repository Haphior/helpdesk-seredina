import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPatch, ApiError } from '../lib/api';
import type { TenantBranding } from '../lib/types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function BrandingSettings() {
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [logoFailed, setLogoFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<TenantBranding>('/tenant-branding').then((b) => {
      setBranding(b);
      setLogoUrl(b.logoUrl ?? '');
      setAccentColor(b.accentColor ?? '');
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const trimmedColor = accentColor.trim();
    if (trimmedColor && !HEX_COLOR.test(trimmedColor)) {
      setError('Accent color must be a hex code like #4f46e5.');
      return;
    }

    setSaving(true);
    try {
      const updated = await apiPatch<TenantBranding>('/tenant-branding', {
        logoUrl: logoUrl.trim() || null,
        accentColor: trimmedColor || null,
      });
      setBranding(updated);
      setLogoFailed(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  }

  if (!branding) {
    return (
      <div className="px-8 py-7">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  const previewColor = accentColor.trim() && HEX_COLOR.test(accentColor.trim()) ? accentColor.trim() : undefined;
  const previewLogo = logoUrl.trim() && !logoFailed ? logoUrl.trim() : null;

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">Branding</h1>
      <p className="mb-6 max-w-xl text-[13.5px] text-slate-500">
        Show your own logo and color on your self-service portal and status page — the pages your customers see,
        not the admin console your agents use.
      </p>

      <div className="grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input
            label="Logo URL"
            type="url"
            value={logoUrl}
            onChange={(e) => {
              setLogoUrl(e.target.value);
              setLogoFailed(false);
            }}
            placeholder="https://yourcompany.com/logo.png"
          />
          <Input
            label="Accent color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            placeholder="#4f46e5"
          />

          {error && <p className="text-sm text-rose-600">{error}</p>}
          {saved && !error && <p className="text-sm text-emerald-600">Saved.</p>}

          <div>
            <Button type="submit" isLoading={saving}>
              Save
            </Button>
          </div>
        </form>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">Preview</span>
          <Card className="!p-5">
            <div className="flex items-center gap-2.5">
              {previewLogo ? (
                <img
                  src={previewLogo}
                  alt=""
                  className="h-7 w-7 rounded object-contain"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <div className="h-7 w-7 rounded bg-slate-100" />
              )}
              <span className="text-[15px] font-bold" style={previewColor ? { color: previewColor } : { color: '#0f172a' }}>
                Help Center
              </span>
            </div>
          </Card>
          <p className="mt-2 text-[12px] text-slate-400">How the portal header looks with your logo and color.</p>
        </div>
      </div>
    </div>
  );
}
