import { DEFAULT_LOCALE, LOCALES, type Locale } from '@sunshop/shared';
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import ar from './ar.json';
import en from './en.json';

/**
 * Client-side translation.
 *
 * Bundled rather than fetched: the catalogues are a few kilobytes gzipped, and
 * loading them over the network means the first paint either blocks on a
 * request or flashes translation keys. The *content* of the store: product
 * names, category names: is localized server-side instead, because that is
 * data, not chrome.
 *
 * Arabic pluralisation has six forms; i18next's ICU-compatible plural
 * resolution handles that from the `_other` / `_few` suffixes, so `{{count}}`
 * strings never need a hand-written conditional.
 */
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...LOCALES],
    // Two-letter codes only: `ar-EG` and `ar-SA` share one catalogue.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: {
      // React already escapes; double-escaping turns an apostrophe into &#39;.
      escapeValue: false,
    },
    detection: {
      // The persisted UI store wins over the browser header, because an
      // explicit choice should survive a visit from a differently-configured
      // device.
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: 'sunshop-admin-language',
      caches: ['localStorage'],
    },
    returnNull: false,
  });

export function changeLanguage(locale: Locale): void {
  void i18n.changeLanguage(locale);
}

export default i18n;
