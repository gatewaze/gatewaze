import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * URLs for the configured branding logos. `null` for either field means
 * "no custom logo set — fall back to the bundled Gatewaze default".
 */
export interface BrandingLogos {
  /** Logo for use on dark backgrounds (e.g. the admin left menu). */
  lightUrl: string | null;
  /** Logo for use on light backgrounds (e.g. the splash/loading screen). */
  darkUrl: string | null;
  /** Square brand mark for dark backgrounds (e.g. the collapsed sidebar rail). */
  iconLightUrl: string | null;
  /** Square brand mark for light backgrounds. */
  iconDarkUrl: string | null;
  /** Set once the fetch has resolved — used to avoid a flash of the default. */
  ready: boolean;
}

const LIGHT_KEY = "logo_url_light";
const DARK_KEY = "logo_url_dark";
const ICON_LIGHT_KEY = "logo_icon_url_light";
const ICON_DARK_KEY = "logo_icon_url_dark";
// Pre-split single icon + favicon — used as fallbacks for both variants.
const ICON_LEGACY_KEY = "logo_icon_url";
const FAVICON_KEY = "favicon_url";

let cache: BrandingLogos = {
  lightUrl: null,
  darkUrl: null,
  iconLightUrl: null,
  iconDarkUrl: null,
  ready: false,
};
let inflight: Promise<void> | null = null;
const subscribers = new Set<(s: BrandingLogos) => void>();

function notify() {
  for (const cb of subscribers) cb(cache);
}

function resolvePath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  if (value.startsWith("/")) return value;
  const { data } = supabase.storage.from("media").getPublicUrl(value);
  return data.publicUrl || null;
}

async function load() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await supabase
        .from("platform_settings")
        .select("key,value")
        .in("key", [
          LIGHT_KEY,
          DARK_KEY,
          ICON_LIGHT_KEY,
          ICON_DARK_KEY,
          ICON_LEGACY_KEY,
          FAVICON_KEY,
        ]);

      const map = new Map<string, string>();
      for (const row of data ?? []) {
        if (row.key && typeof row.value === "string") map.set(row.key, row.value);
      }

      const legacyIcon = resolvePath(map.get(ICON_LEGACY_KEY));
      const favicon = resolvePath(map.get(FAVICON_KEY));

      cache = {
        lightUrl: resolvePath(map.get(LIGHT_KEY)),
        darkUrl: resolvePath(map.get(DARK_KEY)),
        iconLightUrl: resolvePath(map.get(ICON_LIGHT_KEY)) ?? legacyIcon ?? favicon,
        iconDarkUrl: resolvePath(map.get(ICON_DARK_KEY)) ?? legacyIcon ?? favicon,
        ready: true,
      };
    } catch {
      cache = {
        lightUrl: null,
        darkUrl: null,
        iconLightUrl: null,
        iconDarkUrl: null,
        ready: true,
      };
    } finally {
      notify();
    }
  })();
  return inflight;
}

/**
 * Read the current branding logos. Fetched once per page load and cached
 * across all consumers so the sidebar / splash / etc. don't each hit the DB.
 */
export function useBrandingLogos(): BrandingLogos {
  const [state, setState] = useState<BrandingLogos>(cache);

  useEffect(() => {
    subscribers.add(setState);
    if (!cache.ready) load();
    return () => {
      subscribers.delete(setState);
    };
  }, []);

  return state;
}

/** Force a re-fetch after a settings save. */
export function refreshBrandingLogos() {
  inflight = null;
  cache = { ...cache, ready: false };
  notify();
  return load();
}
