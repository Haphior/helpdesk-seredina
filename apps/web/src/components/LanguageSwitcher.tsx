import { useTranslation } from 'react-i18next';
import { setLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';
import { GlobeIcon } from './icons';

const LANGUAGE_LABEL_KEY: Record<SupportedLanguage, string> = {
  en: 'language.english',
  es: 'language.spanish',
};

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = (i18n.language.slice(0, 2) as SupportedLanguage) in LANGUAGE_LABEL_KEY ? (i18n.language.slice(0, 2) as SupportedLanguage) : 'en';

  return (
    <label className="flex items-center gap-2 text-slate-400">
      <GlobeIcon width={15} height={15} className="flex-shrink-0" />
      <span className="sr-only">{t('nav.items.language')}</span>
      <select
        value={current}
        onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
        aria-label={t('nav.items.language')}
        className="w-full cursor-pointer border-none bg-transparent text-[12.5px] font-medium text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-200"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {t(LANGUAGE_LABEL_KEY[lang])}
          </option>
        ))}
      </select>
    </label>
  );
}
