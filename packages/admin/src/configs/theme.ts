import { colors } from "@/constants/colors";
import {
  DarkColor,
  LightColor,
  PrimaryColor,
  ThemeConfig,
} from "./@types/theme";
const DEFAULT_DARK_COLOR: DarkColor = "black";
const DEFAULT_LIGHT_COLOR: LightColor = "slate";

// Get brand-specific default accent color (Radix color names)
const getBrandPrimaryColor = (): PrimaryColor => {
  return "green";
};

const DEFAULT_PRIMARY_COLOR: PrimaryColor = getBrandPrimaryColor();

// Default theme configuration
export const defaultTheme: ThemeConfig = {
  themeMode: "light",
  isMonochrome: false,
  themeLayout: "sideblock",
  cardSkin: "shadow",

  darkColorScheme: {
    name: DEFAULT_DARK_COLOR,
    ...colors[DEFAULT_DARK_COLOR],
  },

  lightColorScheme: {
    name: DEFAULT_LIGHT_COLOR,
    ...colors[DEFAULT_LIGHT_COLOR],
  },

  primaryColorScheme: {
    name: DEFAULT_PRIMARY_COLOR,
    ...colors[DEFAULT_PRIMARY_COLOR],
  },

  notification: {
    isExpanded: false,
    position: "bottom-right",
    visibleToasts: 4,
  },
};
