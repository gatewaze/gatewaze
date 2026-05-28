/**
 * Brand logo component.
 *
 * Reads the configured light/dark logos from `platform_settings` (via
 * `useBrandingLogos`) and falls back to the bundled Gatewaze defaults when
 * the operator hasn't uploaded a custom logo.
 *
 *   - `variant="light"`  → for use on dark backgrounds (e.g. the admin sidebar)
 *   - `variant="dark"`   → for use on light backgrounds (e.g. the splash screen)
 *
 * `type` selects between the wordmark (`logotype`) and the square icon
 * (`logo`). Both honour `variant`: `light` resolves the mark intended for dark
 * backgrounds, `dark` the one for light backgrounds. Icons fall back to the
 * favicon, then the bundled Gatewaze mark.
 */

import { useBrandingLogos } from "@/hooks/useBrandingLogos";

interface BrandLogoProps {
  type?: "logo" | "logotype";
  variant?: "light" | "dark";
  className?: string;
}

const DEFAULT_LOGOTYPE_LIGHT = "/theme/gatewaze/logo_white.svg";
const DEFAULT_LOGOTYPE_DARK = "/theme/gatewaze/logo_black.svg";
const DEFAULT_ICON = "/theme/gatewaze/favicon-192x192.png";

export function BrandLogo({
  type = "logo",
  variant,
  className = "",
}: BrandLogoProps) {
  const { lightUrl, darkUrl, iconLightUrl, iconDarkUrl, ready } =
    useBrandingLogos();

  // Back-compat for callers that still rely on the legacy `text-black`
  // heuristic to pick a variant — treat absence of an explicit variant as a
  // request for the dark logo unless the className hints otherwise.
  const resolvedVariant: "light" | "dark" =
    variant ?? (className.includes("text-black") ? "dark" : "light");

  if (type === "logotype") {
    // Wait for the branding fetch to finish before showing anything —
    // otherwise the bundled Gatewaze fallback flashes briefly before the
    // configured logo loads. Once `ready`, render either the configured
    // logo or the bundled fallback if no logo is set.
    if (!ready) return null;

    const custom = resolvedVariant === "light" ? lightUrl : darkUrl;
    const fallback =
      resolvedVariant === "light"
        ? DEFAULT_LOGOTYPE_LIGHT
        : DEFAULT_LOGOTYPE_DARK;

    return (
      <img
        src={custom ?? fallback}
        alt="Logo"
        className={className}
        style={{ objectFit: "contain" }}
      />
    );
  }

  // Wait for the branding fetch so the bundled fallback doesn't flash before a
  // configured icon loads.
  if (!ready) return null;

  const icon = resolvedVariant === "light" ? iconLightUrl : iconDarkUrl;

  return (
    <img
      src={icon ?? DEFAULT_ICON}
      alt="Logo"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
