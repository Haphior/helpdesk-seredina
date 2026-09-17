import { useEffect, useState } from 'react';
import { apiGet, apiPut, ApiError } from '../lib/api';
import type { NotificationPreference } from '../lib/types';

export function NotificationSettings() {
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiGet<{ preferences: NotificationPreference[] }>('/notification-preferences')
      .then((res) => setPreferences(res.preferences))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load notification settings'));
  }

  useEffect(load, []);

  async function toggle(eventType: string, field: 'inApp' | 'email', value: boolean) {
    setPreferences((prev) => prev?.map((p) => (p.eventType === eventType ? { ...p, [field]: value } : p)) ?? null);
    try {
      await apiPut(`/notification-preferences/${eventType}`, { [field]: value });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
      load();
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">Notification Settings</h1>
      <p className="mb-6 text-[13.5px] text-slate-500">
        How you're told about ticket activity — in-app always shows in the bell, email needs an active Email Channel to
        actually send.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {preferences === null && <p className="text-sm text-slate-500">Loading…</p>}

      {preferences && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1fr_90px_90px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
            <span>Event</span>
            <span>In-app</span>
            <span>Email</span>
          </div>
          <div className="divide-y divide-slate-100">
            {preferences.map((p) => (
              <div key={p.eventType} className="grid grid-cols-[1fr_90px_90px] items-center gap-3 px-5 py-3.5">
                <span className="text-[13.5px] text-slate-700">{p.label}</span>
                <input
                  type="checkbox"
                  checked={p.inApp}
                  onChange={(e) => toggle(p.eventType, 'inApp', e.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
                <input
                  type="checkbox"
                  checked={p.email}
                  onChange={(e) => toggle(p.eventType, 'email', e.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
