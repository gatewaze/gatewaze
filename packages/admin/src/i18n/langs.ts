export const locales = {
  en: {
    label: "English",
    dayjs: () => import("dayjs/locale/en"),
    flatpickr: null,
    i18n: () => import("./locales/en/translations.json"),
    flag: "united-kingdom",
  },
};

export const supportedLanguages = Object.keys(locales);

export type LocaleCode = keyof typeof locales;

export type Dir = "ltr" | "rtl";
