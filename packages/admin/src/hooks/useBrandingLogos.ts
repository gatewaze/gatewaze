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
  /** Set once the fetch has resolved — used to avoid a flash of the default. */
  ready: boolean;
}

const LIGHT_KEY = "logo_url_light";
const DARK_KEY = "logo_url_dark";

let cache: BrandingLogos = { lightUrl: null, darkUrl: null, ready: false };
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
        .in("key", [LIGHT_KEY, DARK_KEY]);

      const map = new Map<string, string>();
      for (const row of data ?? []) {
        if (row.key && typeof row.value === "string") map.set(row.key, row.value);
      }

      cache = {
        lightUrl: resolvePath(map.get(LIGHT_KEY)),
        darkUrl: resolvePath(map.get(DARK_KEY)),
        ready: true,
      };
    } catch {
      cache = { lightUrl: null, darkUrl: null, ready: true };
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
