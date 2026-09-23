import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPatch, ApiError } from '../lib/api';
import { ChannelGlyph } from '../components/ChannelGlyph';
import { useTheme, type UiTheme } from '../theme/ThemeContext';

interface ThemeOption {
  key: UiTheme;
  name: string;
  description: string;
}

function ThemeSwatch({ theme }: { theme: UiTheme }) {
  const bg = theme === 'refined' ? '#f8fafc' : '#f7f5f1';
  const card = '#fff';
  const border = theme === 'refined' ? '#e2e8f0' : '#e4ded2';
  const accent = '#4f46e5';
  return (
    <div className="h-20 w-full overflow-hidden rounded-lg border" style={{ background: bg, borderColor: border }}>
      <div className="flex h-full items-center gap-2 p-2.5">
        <div className="h-full w-8 rounded" style={{ background: card, border: `1px solid ${border}` }} />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-2 w-3/4 rounded-full" style={{ background: accent, opacity: 0.8 }} />
          <div className="h-2 w-full rounded-full" style={{ background: card, border: `1px solid ${border}` }} />
          <div className="h-2 w-1/2 rounded-full" style={{ background: card, border: `1px solid ${border}` }} />
        </div>
      </div>
    </div>
  );
}

export function ThemeSettings() {
  const { t } = useTranslation();
  const { theme, applyTheme } = useTheme();
  const [options, setOptions] = useState<ThemeOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingTheme, setSavingTheme] = useState<UiTheme | null>(null);

  useEffect(() => {
    apiGet<{ themes: ThemeOption[] }>('/ui-settings/themes')
      .then((res) => setOptions(res.themes))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('theme.loadFailed')));
  }, []);

  async function choose(next: UiTheme) {
    if (next === theme) return;
    const previous = theme;
    setError(null);
    setSavingTheme(next);
    applyTheme(next); // instant: the whole app re-themes right away, saved below
    try {
      await apiPatch('/ui-settings', { theme: next });
    } catch (err) {
      applyTheme(previous);
      setError(err instanceof ApiError ? err.message : t('theme.saveFailed'));
    } finally {
      setSavingTheme(null);
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('theme.title')}</h1>
      <p className="mb-6 max-w-xl text-[13.5px] text-slate-500">
        {t('theme.intro')}
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {!options && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {options && (
        <div className="grid max-w-2xl grid-cols-2 gap-4">
          {options.map((opt) => {
            const selected = theme === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => choose(opt.key)}
                disabled={savingTheme !== null}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  selected ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <ThemeSwatch theme={opt.key} />
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-slate-800">{t(`theme.options.${opt.key}.name`, { defaultValue: opt.name })}</span>
                  {opt.key === 'middle' && <ChannelGlyph channel="email" />}
                  {selected && <span className="ml-auto text-[11px] font-semibold uppercase tracking-wide text-indigo-600">{t('theme.active')}</span>}
                </div>
                <p className="mt-1 text-[12.5px] text-slate-500">{t(`theme.options.${opt.key}.description`, { defaultValue: opt.description })}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
