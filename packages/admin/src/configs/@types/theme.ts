import { ToasterProps } from "sonner";

// Define color options
export type DarkColor = "cinder" | "navy" | "mirage" | "black" | "mint";
export type LightColor = "slate" | "gray" | "neutral";
export type PrimaryColor =
  | "pink"
  | "red"
  | "crimson"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "plum"
  | "cyan"
  | "rose";

export type ThemeMode = "light" | "dark" | "system";
export type IsMonochrome = boolean;
export type ThemeLayout = "main-layout" | "sideblock";
export type CardSkin = "bordered" | "shadow";

export interface DarkColorScheme {
  name: DarkColor;
  [key: string]: string;
}

export interface LightColorScheme {
  name: LightColor;
  [key: string]: string;
}

export interface PrimaryColorScheme {
  name: PrimaryColor;
  [key: string]: string;
}

export interface Notification {
  isExpanded: boolean;
  position: ToasterProps["position"];
  visibleToasts: number;
}

export interface ThemeConfig {
  themeMode: ThemeMode;
  isMonochrome: IsMonochrome;
  themeLayout: ThemeLayout;
  cardSkin: CardSkin;
  darkColorScheme: DarkColorScheme;
  lightColorScheme: LightColorScheme;
  primaryColorScheme: PrimaryColorScheme;
  notification: Notification;
}
