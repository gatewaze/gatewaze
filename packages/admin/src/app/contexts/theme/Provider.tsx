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

  // Migrate old brand color names to Radix accent names on mount
  useEffect(() => {
    const expectedPrimaryColor: PrimaryColor = "green";

    const currentName = settings.primaryColorScheme?.name;
    const needsMigration =
      currentName === ("mlops-pink" as string) ||
      currentName === ("techtickets-red" as string) ||
      currentName === ("pink" as string) ||
      currentName === ("red" as string) ||
      !currentName;

    if (needsMigration) {
      setSettings((prevSettings) => ({
        ...prevSettings,
        primaryColorScheme: {
          name: expectedPrimaryColor,
          ...colors[expectedPrimaryColor],
        },
      }));
    }
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
