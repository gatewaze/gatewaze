export const APP_NAME = "Admin";
export const APP_KEY = "Admin";

// Redirect Paths
export const REDIRECT_URL_KEY = "redirect";
export const HOME_PATH = "/";
export const GHOST_ENTRY_PATH = "/login";

// Navigation Types
export type NavigationType = "root" | "group" | "collapse" | "item" | "divider";

export const COLORS = [
  "neutral",
  "primary",
  "secondary",
  "info",
  "success",
  "warning",
  "error",
  "blue",
  "brown",
  "crimson",
  "cyan",
  "gold",
  "gray",
  "green",
  "indigo",
  "lime",
  "orange",
  "pink",
  "plum",
  "purple",
  "red",
  "teal",
  "tomato",
  "violet",
  "yellow",
  "ruby",
  "iris",
  "jade",
  "bronze",
  "sky",
  "mint",
  "amber",
] as const;

export type ColorType = (typeof COLORS)[number];
