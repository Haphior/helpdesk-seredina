import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'seredina.language';

function detectLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) return stored as SupportedLanguage;
  } catch {
    // localStorage unavailable (private browsing, blocked storage) -- fall through to browser detection
  }
  const browserLang = navigator.language.slice(0, 2);
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(browserLang) ? (browserLang as SupportedLanguage) : 'en';
}

export function setLanguage(lang: SupportedLanguage) {
  i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // per-viewer convenience only -- losing this just means detection re-runs next visit
  }
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
