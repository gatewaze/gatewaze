// Import Dependencies
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Transition,
} from "@headlessui/react";
import clsx from "clsx";
import { useState } from "react";

// Local Imports
import { Button, Spinner } from "@/components/ui";
import { useLocaleContext } from "@/app/contexts/locale/context";
import { locales, LocaleCode } from "@/i18n/langs";

// ----------------------------------------------------------------------

interface LanguageItem {
  value: LocaleCode;
  label: string;
  flag: string;
}

const langs: LanguageItem[] = Object.keys(locales).map((key) => ({
  value: key as LocaleCode,
  label: locales[key as LocaleCode].label,
  flag: locales[key as LocaleCode].flag,
}));

const LanguageSelector = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const { locale, updateLocale } = useLocaleContext();

  const onLanguageSelect = async (lang: LocaleCode) => {
    setLoading(true);
    try {
      await updateLocale(lang);
      setLoading(false);
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  };

  return (
    <Listbox as="div" value={locale} onChange={onLanguageSelect}>
      <div className="relative">
        <ListboxButton
          as={Button}
          variant="flat"
          isIcon
          className="size-9 rounded-full"
        >
          {loading ? (
            <Spinner color="primary" className="size-5" />
          ) : (
            <img
              className="size-6"
              src={`/images/flags/svg/rounded/${locales[locale as LocaleCode].flag}.svg`}
              alt={locale}
            />
          )}
        </ListboxButton>
        <Transition
          enter="transition ease-out"
          enterFrom="opacity-0 translate-y-2"
          enterTo="opacity-100 translate-y-0"
          leave="transition ease-in"
          leaveFrom="opacity-100 translate-y-0"
          leaveTo="opacity-0 translate-y-2"
        >
          <ListboxOptions
            anchor={{ to: "bottom end", gap: 8 }}
            className="z-101 w-min min-w-[10rem] overflow-y-auto rounded-lg border border-[var(--gray-a5)] bg-[var(--color-background)] py-1 font-medium shadow-lg shadow-gray-200/50 outline-hidden focus-visible:outline-hidden ltr:right-0 rtl:left-0 dark:shadow-none"
          >
            {langs.map((lang) => (
              <ListboxOption
                key={lang.value}
                className={({ selected, active }) =>
                  clsx(
                    "relative flex cursor-pointer px-4 py-2 transition-colors select-none",
                    active && !selected && "bg-[var(--gray-a3)]",
                    selected
                      ? "bg-primary-600 dark:bg-primary-500 text-white"
                      : "text-[var(--gray-12)]",
                  )
                }
                value={lang.value}
              >
                <div className="flex space-x-3 rtl:space-x-reverse">
                  <img
                    className="size-5"
                    src={`/images/flags/svg/rounded/${lang.flag}.svg`}
                    alt={lang.value}
                  />
                  <span className="block truncate">{lang.label}</span>
                </div>
              </ListboxOption>
            ))}
          </ListboxOptions>
        </Transition>
      </div>
    </Listbox>
  );
};

export { LanguageSelector };
