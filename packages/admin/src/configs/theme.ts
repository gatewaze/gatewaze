// @ts-nocheck
import { colors } from "@/constants/colors";
import {
  DarkColor,
  LightColor,
  PrimaryColor,
  SecondaryColor,
  ThemeConfig,
} from "./@types/theme";
import { getBrandId } from "@/config/brands";

const DEFAULT_DARK_COLOR: DarkColor = "cinder";
const DEFAULT_LIGHT_COLOR: LightColor = "slate";

// Get brand-specific primary color
const getBrandPrimaryColor = (): PrimaryColor => {
  const brand = getBrandId();
  return brand === "techtickets" ? "techtickets-red" : "mlops-pink";
};

// Get brand-specific secondary color
const getBrandSecondaryColor = (): SecondaryColor => {
  const brand = getBrandId();
  return brand === "techtickets" ? "techtickets-dark-blue" : "mlops-blue";
};

const DEFAULT_PRIMARY_COLOR: PrimaryColor = getBrandPrimaryColor();
const DEFAULT_SECONDARY_COLOR: SecondaryColor = getBrandSecondaryColor();

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

  secondaryColorScheme: {
    name: DEFAULT_SECONDARY_COLOR,
    ...colors[DEFAULT_SECONDARY_COLOR],
  },

  notification: {
    isExpanded: false,
    position: "bottom-right",
    visibleToasts: 4,
  },
};
