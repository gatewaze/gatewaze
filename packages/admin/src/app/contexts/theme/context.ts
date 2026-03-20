import { createSafeContext } from "@/utils/createSafeContext";

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

export interface ThemeContextValue extends ThemeConfig {
  isDark: boolean;
  setThemeMode: (val: ThemeMode) => void;
  setThemeLayout: (val: ThemeLayout) => void;
  setMonochromeMode: (val: IsMonochrome) => void;
  setLightColorScheme: (val: LightColor) => void;
  setDarkColorScheme: (val: DarkColor) => void;
  setPrimaryColorScheme: (val: PrimaryColor) => void;
  setNotificationPosition: (val: Notification["position"]) => void;
  setNotificationExpand: (val: boolean) => void;
  setNotificationMaxCount: (val: number) => void;
  setCardSkin: (val: CardSkin) => void;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
  resetTheme: () => void;
}

export const [ThemeContext, useThemeContext] =
  createSafeContext<ThemeContextValue>(
    "useThemeContext must be used within ThemeProvider"
  );
