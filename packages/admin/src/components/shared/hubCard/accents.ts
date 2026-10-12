import { NAV_HUB_ACCENTS } from "@gatewaze/shared";
import type { NavHubAccent } from "@gatewaze/shared/modules";

/** Display names for the accent picker. */
export const ACCENT_LABELS: Record<NavHubAccent, string> = {
  violet: "Violet",
  blue: "Blue",
  green: "Green",
  amber: "Amber",
  red: "Red",
  sky: "Sky",
  purple: "Purple",
  teal: "Teal",
};

/** A card's accent: its own, else one picked by its position on the page. */
export function cardAccent(accent: NavHubAccent | undefined, index: number): NavHubAccent {
  return accent ?? NAV_HUB_ACCENTS[index % NAV_HUB_ACCENTS.length];
}

/**
 * Colours for an accent, from the Radix Themes scales the admin already
 * loads, so they follow light and dark mode without extra CSS.
 */
export function accentColors(accent: NavHubAccent): { edge: string; tileBg: string; tileFg: string } {
  return {
    edge: `var(--${accent}-9)`,
    tileBg: `var(--${accent}-a3)`,
    tileFg: `var(--${accent}-11)`,
  };
}
