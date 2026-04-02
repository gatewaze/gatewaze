import { Dir, LocaleCode } from "@/i18n/langs";
import { createSafeContext } from "@/utils/createSafeContext";

interface LocaleContextType {
  locale: LocaleCode;
  updateLocale: (newLocale: LocaleCode) => Promise<void>;
  direction: Dir;
  setDirection: (dir: Dir) => void;
  isRtl: boolean;
}

export const [LocaleContext, useLocaleContext] =
  createSafeContext<LocaleContextType>(
    "useLocaleContext must be used within LocaleProvider",
  );
