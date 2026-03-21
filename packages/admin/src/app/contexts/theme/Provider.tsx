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

// Reference colors for each Radix accent (approximate hue center)
const RADIX_ACCENT_REFS: { name: PrimaryColor; r: number; g: number; b: number }[] = [
  { name: "red",     r: 229, g: 72,  b: 77  },
  { name: "crimson", r: 233, g: 61,  b: 130 },
  { name: "pink",    r: 214, g: 64,  b: 159 },
  { name: "plum",    r: 171, g: 74,  b: 186 },
  { name: "purple",  r: 142, g: 78,  b: 198 },
  { name: "violet",  r: 110, g: 86,  b: 207 },
  { name: "indigo",  r: 62,  g: 99,  b: 214 },
  { name: "blue",    r: 59,  g: 130, b: 246 },
  { name: "teal",    r: 18,  g: 165, b: 148 },
  { name: "green",   r: 34,  g: 197, b: 94  },
  { name: "amber",   r: 245, g: 158, b: 11  },
  { name: "orange",  r: 247, g: 107, b: 21  },
  { name: "rose",    r: 244, g: 63,  b: 94  },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  hex = hex.trim().replace("#", "");
  if (hex.length !== 6) return null;
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}

function closestRadixAccent(hex: string): PrimaryColor {
  const rgb = hexToRgb(hex);
  if (!rgb) return "blue";
  // If the color is very dark or desaturated, use a neutral accent
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const lightness = (max + min) / 2;
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (lightness < 40 || saturation < 0.15) return "violet";
  let best: PrimaryColor = "blue";
  let bestDist = Infinity;
  for (const ref of RADIX_ACCENT_REFS) {
    const dr = rgb.r - ref.r;
    const dg = rgb.g - ref.g;
    const db = rgb.b - ref.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = ref.name;
    }
  }
  return best;
}
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
          .in("key", ["primary_color", "font_heading", "font_heading_weight", "font_body", "font_body_weight"]);

        const map: Record<string, string> = {};
        for (const row of data ?? []) map[row.key] = row.value as string;

        // Accent color
        const brandHex = map.primary_color;
        const accent = brandHex ? closestRadixAccent(brandHex) : "green";
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
          // Apply font-family to document
          const stack: string[] = [];
          if (fontHeading) stack.push(fontHeading);
          if (fontBody && fontBody !== fontHeading) stack.push(fontBody);
          stack.push("ui-sans-serif", "system-ui", "sans-serif");
          document.documentElement.style.fontFamily = stack.join(", ");

          // Apply font weights as CSS custom properties
          if (map.font_heading_weight) {
            document.documentElement.style.setProperty("--font-weight-heading", map.font_heading_weight);
          }
          if (map.font_body_weight) {
            document.documentElement.style.setProperty("--font-weight-body", map.font_body_weight);
          }
        }
      } catch {
        // If fetch fails, keep current settings
      }
    }

    syncBrandSettings();
  }, []); // Run once on mount

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
