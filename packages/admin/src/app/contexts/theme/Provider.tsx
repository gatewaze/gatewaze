import { ReactNode, useLayoutEffect, useEffect } from "react";

// Local Imports
import { useLocalStorage, useMediaQuery } from "@/hooks/index";
import { ThemeContext, type ThemeContextValue } from "./context";
import {
  CardSkin,
  DarkColor,
  IsMonochrome,
  LightColor,
  Notification,
  PrimaryColor,
  ThemeConfig,
  ThemeLayout,
  ThemeMode,
} from "@/configs/@types/theme";
import { defaultTheme } from "@/configs/theme";
import { colors } from "@/constants/colors";
import { getSupabase } from "@/lib/supabase";
import { useActiveThemeModule } from "@/hooks/useActiveThemeModule";

// Valid Radix accent color names
const VALID_ACCENTS: PrimaryColor[] = [
  "red", "crimson", "pink", "plum", "purple", "violet", "indigo",
  "blue", "cyan", "teal", "green", "amber", "orange", "rose",
];

// ----------------------------------------------------------------------

const initialState: ThemeContextValue = {
  ...defaultTheme,
  setThemeMode: () => {},
  setThemeLayout: () => {},
  setMonochromeMode: () => {},
  setCardSkin: () => {},
  setLightColorScheme: () => {},
  setDarkColorScheme: () => {},
  setPrimaryColorScheme: () => {},
  setSecondaryColor: () => {},
  setNotificationPosition: () => {},
  setNotificationExpand: () => {},
  setNotificationMaxCount: () => {},
  resetTheme: () => {},
  isDark: false,
  setSettings: () => {},
};

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

const _html = document?.documentElement;

export interface ThemeProviderProps {
  children: ReactNode;
  /**
   * Scope theme class/dataset/CSS-variable mutations to this element
   * instead of `document.documentElement`/`document.body`. Used by the
   * embed entry point so a mounted instance never mutates the host
   * page's `<html>`/`<body>` (containment requirement). Omit for the
   * normal app, which keeps mutating the real document root/body.
   */
  container?: HTMLElement | null;
}

export function ThemeProvider({ children, container }: ThemeProviderProps) {
  const isDarkOS = useMediaQuery(COLOR_SCHEME_QUERY);
  const activeTheme = useActiveThemeModule();
  const root = container ?? _html;
  const bodyTarget = container ?? document.body;

  const [settings, setSettings] = useLocalStorage<ThemeConfig>("settings", {
    themeMode: initialState.themeMode,
    themeLayout: initialState.themeLayout,
    cardSkin: initialState.cardSkin,
    isMonochrome: initialState.isMonochrome,
    darkColorScheme: initialState.darkColorScheme || defaultTheme.darkColorScheme,
    lightColorScheme: initialState.lightColorScheme || defaultTheme.lightColorScheme,
    primaryColorScheme: initialState.primaryColorScheme || defaultTheme.primaryColorScheme,
    notification: { ...initialState.notification },
  });

  const isDark =
    (settings.themeMode === "system" && isDarkOS) ||
    settings.themeMode === "dark";

  // Sync Radix accent color and brand fonts from platform branding settings on mount
  useEffect(() => {
    async function syncBrandSettings() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from("platform_settings")
          .select("key, value")
          .in("key", ["admin_accent_color", "admin_secondary_color"]);

        const map: Record<string, string> = {};
        for (const row of data ?? []) map[row.key] = row.value as string;

        // Admin primary color — stored as a Radix color name directly
        const accentName = map.admin_accent_color as PrimaryColor | undefined;
        const accent: PrimaryColor = accentName && VALID_ACCENTS.includes(accentName) ? accentName : "cyan";
        if (settings.primaryColorScheme?.name !== accent) {
          setSettings((prev) => ({
            ...prev,
            primaryColorScheme: { name: accent, ...colors[accent] },
          }));
        }

        // Admin secondary/accent color — also a Radix color name. Left unset
        // when not configured so consumers fall back to the primary.
        const secondaryName = map.admin_secondary_color as PrimaryColor | undefined;
        const secondary = secondaryName && VALID_ACCENTS.includes(secondaryName) ? secondaryName : undefined;
        if (secondary && settings.secondaryColor !== secondary) {
          setSettings((prev) => ({ ...prev, secondaryColor: secondary }));
        }

        // NOTE: font_heading / font_body settings are deliberately
        // NOT applied to the admin UI. Those values configure the
        // PORTAL only (see packages/portal/config/brand.ts). The
        // admin pins itself to Poppins (headings) + Inter (body) via
        // src/styles/app/components/radixOverrides.css's
        // `.radix-themes { --default-font-family / --heading-font-family }`
        // declarations so platform_settings changes can't change the
        // admin chrome's typography.
      } catch {
        // If fetch fails, keep current settings
      }
    }

    syncBrandSettings();
  }, []); // Run once on mount

  // Apply admin theme overrides from active theme module
  useEffect(() => {
    if (!activeTheme) return;
    const overrides = activeTheme.themeOverrides.admin;
    if (!overrides) return;

    setSettings((prev: ThemeConfig) => {
      const next = { ...prev };
      if (overrides.themeMode) {
        next.themeMode = overrides.themeMode as ThemeMode;
      }
      if (overrides.primaryColor && overrides.primaryColor in colors) {
        const name = overrides.primaryColor as PrimaryColor;
        next.primaryColorScheme = { name, ...colors[name] };
      }
      if (overrides.lightColor && overrides.lightColor in colors) {
        const name = overrides.lightColor as LightColor;
        next.lightColorScheme = { name, ...colors[name] };
      }
      if (overrides.darkColor && overrides.darkColor in colors) {
        const name = overrides.darkColor as DarkColor;
        next.darkColorScheme = { name, ...colors[name] };
      }
      if (overrides.cardSkin) {
        next.cardSkin = overrides.cardSkin as CardSkin;
      }
      if (overrides.themeLayout) {
        next.themeLayout = overrides.themeLayout as ThemeLayout;
      }
      return next;
    });
  }, [activeTheme]);

  const setThemeMode = (val: ThemeMode) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      themeMode: val,
    }));
  };

  const setThemeLayout = (val: ThemeLayout) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      themeLayout: val,
    }));
  };

  const setMonochromeMode = (val: IsMonochrome) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      isMonochrome: val,
    }));
  };

  const setDarkColorScheme = (val: DarkColor) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      darkColorScheme: {
        name: val,
        ...colors[val],
      },
    }));
  };

  const setLightColorScheme = (val: LightColor) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      lightColorScheme: {
        name: val,
        ...colors[val],
      },
    }));
  };

  const setPrimaryColorScheme = (val: PrimaryColor) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      primaryColorScheme: {
        name: val,
        ...colors[val],
      },
    }));
  };

  const setSecondaryColor = (val: PrimaryColor) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      secondaryColor: val,
    }));
  };

  const setNotificationPosition = (val: Notification["position"]) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      notification: {
        ...prevSettings.notification,
        position: val,
      },
    }));
  };

  const setNotificationExpand = (val: boolean) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      notification: {
        ...prevSettings.notification,
        isExpanded: val,
      },
    }));
  };

  const setNotificationMaxCount = (val: number) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      notification: {
        ...prevSettings.notification,
        visibleToasts: val,
      },
    }));
  };

  const setCardSkin = (val: CardSkin) => {
    setSettings((prevSettings) => ({
      ...prevSettings,
      cardSkin: val,
    }));
  };

  const resetTheme = () => {
    setSettings({
      themeMode: initialState.themeMode,
      themeLayout: initialState.themeLayout,
      isMonochrome: initialState.isMonochrome,
      darkColorScheme: initialState.darkColorScheme,
      lightColorScheme: initialState.lightColorScheme,
      primaryColorScheme: initialState.primaryColorScheme,
      cardSkin: initialState.cardSkin,
      notification: { ...initialState.notification },
    });
  };

  useLayoutEffect(() => {
    if (isDark) root?.classList.add("dark");
    else root?.classList.remove("dark");
  }, [isDark, root]);

  useLayoutEffect(() => {
    if (settings.isMonochrome) bodyTarget.classList.add("is-monochrome");
    else bodyTarget.classList.remove("is-monochrome");
  }, [settings.isMonochrome, bodyTarget]);

  useLayoutEffect(() => {
    if (settings.lightColorScheme?.name) {
      root!.dataset.themeLight = settings.lightColorScheme.name;
    }
  }, [settings.lightColorScheme, root]);

  useLayoutEffect(() => {
    if (settings.darkColorScheme?.name) {
      root!.dataset.themeDark = settings.darkColorScheme.name;
    }
  }, [settings.darkColorScheme, root]);

  useLayoutEffect(() => {
    if (settings.primaryColorScheme?.name) {
      root!.dataset.themePrimary = settings.primaryColorScheme.name;
    }
  }, [settings.primaryColorScheme, root]);

  // Alias --secondary-9 to the chosen secondary colour's Radix scale (which
  // adapts to light/dark on its own). Falls back to the primary when no
  // secondary is configured so the breadcrumb flag looks unchanged by default.
  // Radix has no "rose" scale — it maps to "pink".
  useLayoutEffect(() => {
    const name = settings.secondaryColor ?? settings.primaryColorScheme?.name;
    if (name && root) {
      const scale = name === "rose" ? "pink" : name;
      // -1 = the faintest tint (app-background level); -2 = a subtle tint;
      // -9 = the saturated colour (flag fill, underlines); -11 = the readable
      // text shade. Mirrors how the primary uses --accent-1/-2/-9/-11.
      root.style.setProperty("--secondary-1", `var(--${scale}-1)`);
      root.style.setProperty("--secondary-2", `var(--${scale}-2)`);
      root.style.setProperty("--secondary-9", `var(--${scale}-9)`);
      root.style.setProperty("--secondary-11", `var(--${scale}-11)`);
      root.dataset.themeSecondary = name;
    }
  }, [settings.secondaryColor, settings.primaryColorScheme, root]);

  useLayoutEffect(() => {
    root!.dataset.cardSkin = settings.cardSkin;
  }, [settings.cardSkin, root]);

  useLayoutEffect(() => {
    bodyTarget.dataset.layout = settings.themeLayout;
  }, [settings.themeLayout, bodyTarget]);

  if (!children) {
    return null;
  }

  const contextValue: ThemeContextValue = {
    ...settings,
    isDark,
    setMonochromeMode,
    setThemeMode,
    setThemeLayout,
    setLightColorScheme,
    setDarkColorScheme,
    setPrimaryColorScheme,
    setSecondaryColor,
    setNotificationPosition,
    setNotificationExpand,
    setNotificationMaxCount,
    setCardSkin,
    setSettings,
    resetTheme,
  };

  return <ThemeContext value={contextValue}>{children}</ThemeContext>;
}
