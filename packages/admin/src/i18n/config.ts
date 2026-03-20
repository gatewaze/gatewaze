// Import Dependencies
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Local Imports
import { type LocaleCode, supportedLanguages } from "./langs";

// Translation files
import enTranslations from "./locales/en/translations.json";

// ----------------------------------------------------------------------

export const defaultLang: LocaleCode = "en";
export const fallbackLang: LocaleCode = "en";

i18n
  .use(initReactI18next)
  .init({
    fallbackLng: fallbackLang,
    lng: defaultLang,
    supportedLngs: supportedLanguages,
    ns: ["translations"],
    defaultNS: "translations",
    resources: {
      en: {
        translations: enTranslations,
      },
    },
    interpolation: {
      escapeValue: false,
    },
    lowerCaseLng: true,
    debug: false,
  });

i18n.languages = supportedLanguages;

export default i18n;
