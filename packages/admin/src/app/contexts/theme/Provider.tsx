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
  setNotificationPosition: () => {},
  setNotificationExpand: () => {},
  setNotificationMaxCount: () => {},
  resetTheme: () => {},
  isDark: false,
  setSettings: () => {},
};

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

const _html = document?.documentElement;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const isDarkOS = useMediaQuery(COLOR_SCHEME_QUERY);
  const activeTheme = useActiveThemeModule();

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
          .in("key", ["admin_accent_color", "font_heading", "font_heading_weight", "font_body", "font_body_weight"]);

        const map: Record<string, string> = {};
        for (const row of data ?? []) map[row.key] = row.value as string;

        // Admin accent color — stored as a Radix color name directly
        const accentName = map.admin_accent_color as PrimaryColor | undefined;
        const accent: PrimaryColor = accentName && VALID_ACCENTS.includes(accentName) ? accentName : "cyan";
        if (settings.primaryColorScheme?.name !== accent) {
          setSettings((prev) => ({
            ...prev,
            primaryColorScheme: { name: accent, ...colors[accent] },
          }));
        }

        // Brand fonts
        const fontHeading = map.font_heading;
        const fontBody = map.font_body;
        if (fontHeading || fontBody) {
          // Build Google Fonts URL
          const baseWeights = [400, 500, 600, 700];
          const fonts: { name: string; weights: string }[] = [];
          if (fontHeading) {
            const w = new Set(baseWeights);
            if (map.font_heading_weight) w.add(Number(map.font_heading_weight));
            fonts.push({ name: fontHeading, weights: [...w].sort((a, b) => a - b).join(";") });
          }
          if (fontBody && fontBody !== fontHeading) {
            const w = new Set(baseWeights);
            if (map.font_body_weight) w.add(Number(map.font_body_weight));
            fonts.push({ name: fontBody, weights: [...w].sort((a, b) => a - b).join(";") });
          }
          if (fonts.length > 0) {
            const params = fonts
              .map((f) => `family=${encodeURIComponent(f.name)}:wght@${f.weights}`)
              .join("&");
            const href = `https://fonts.googleapis.com/css2?${params}&display=swap`;
            // Inject stylesheet if not already present
            if (!document.querySelector(`link[href="${href}"]`)) {
              const link = document.createElement("link");
              link.rel = "stylesheet";
              link.href = href;
              document.head.appendChild(link);
            }
          }
          // Build font stack and apply to the Radix .radix-themes element
          // directly, since Radix sets --default-font-family on that element.
          const stack: string[] = [];
          if (fontHeading) stack.push(`'${fontHeading}'`);
          if (fontBody && fontBody !== fontHeading) stack.push(`'${fontBody}'`);
          stack.push("ui-sans-serif", "system-ui", "sans-serif");
          const fontStack = stack.join(", ");

          const headingStack = fontHeading
            ? `'${fontHeading}', ${fontStack}`
            : fontStack;

          function applyFontToRadix(el: HTMLElement) {
            el.style.setProperty("--default-font-family", fontStack);
            el.style.setProperty("--heading-font-family", headingStack);
            if (map.font_heading_weight) {
              el.style.setProperty("--font-weight-heading", map.font_heading_weight);
            }
            if (map.font_body_weight) {
              el.style.setProperty("--font-weight-body", map.font_body_weight);
            }
          }

          const radixEl = document.querySelector(".radix-themes") as HTMLElement | null;
          if (radixEl) {
            applyFontToRadix(radixEl);
          } else {
            // Radix element not yet mounted — wait for it
            const observer = new MutationObserver((_mutations, obs) => {
              const el = document.querySelector(".radix-themes") as HTMLElement | null;
              if (el) {
                applyFontToRadix(el);
                obs.disconnect();
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
          }
        }
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
    if (isDark) _html?.classList.add("dark");
    else _html?.classList.remove("dark");
  }, [isDark]);

  useLayoutEffect(() => {
    if (settings.isMonochrome) document.body.classList.add("is-monochrome");
    else document.body.classList.remove("is-monochrome");
  }, [settings.isMonochrome]);

  useLayoutEffect(() => {
    if (settings.lightColorScheme?.name) {
      _html!.dataset.themeLight = settings.lightColorScheme.name;
    }
  }, [settings.lightColorScheme]);

  useLayoutEffect(() => {
    if (settings.darkColorScheme?.name) {
      _html!.dataset.themeDark = settings.darkColorScheme.name;
    }
  }, [settings.darkColorScheme]);

  useLayoutEffect(() => {
    if (settings.primaryColorScheme?.name) {
      _html!.dataset.themePrimary = settings.primaryColorScheme.name;
    }
  }, [settings.primaryColorScheme]);

  useLayoutEffect(() => {
    _html!.dataset.cardSkin = settings.cardSkin;
  }, [settings.cardSkin]);

  useLayoutEffect(() => {
    if (document) document.body.dataset.layout = settings.themeLayout;
  }, [settings.themeLayout]);

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
    setNotificationPosition,
    setNotificationExpand,
    setNotificationMaxCount,
    setCardSkin,
    setSettings,
    resetTheme,
  };

  return <ThemeContext value={contextValue}>{children}</ThemeContext>;
}
