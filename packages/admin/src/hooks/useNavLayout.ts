import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { NavLayout } from "@gatewaze/shared/modules";

/** platform_settings key holding the org-wide layout (JSON string). */
export const ORG_NAV_LAYOUT_KEY = "admin_nav_layout";

/** Narrow an untyped value into a NavLayout, or null when absent/malformed. */
function parseLayout(raw: unknown): NavLayout | null {
  if (raw == null) return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (obj && typeof obj === "object" && Array.isArray((obj as NavLayout).sidebar)) {
      return obj as NavLayout;
    }
  } catch {
    // A malformed stored layout must never break navigation — fall back to
    // module defaults rather than throwing.
  }
  return null;
}

export interface UseNavLayoutResult {
  /** Effective layout: per-user override if present, else org default, else null. */
  layout: NavLayout | null;
  /** True once both reads have settled (success or failure). */
  ready: boolean;
}

/**
 * Loads the effective admin nav layout. The per-user override (RLS-scoped to
 * the caller) wins over the org-wide default; absence of both yields `null`,
 * which the resolver treats as "use module defaults".
 */
export function useNavLayout(): UseNavLayoutResult {
  const [layout, setLayout] = useState<NavLayout | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = getSupabase();
        // Settle independently so a failure on one layer (e.g. the prefs table
        // not yet migrated) doesn't discard the other layer's result.
        const [orgRes, userRes] = await Promise.allSettled([
          supabase
            .from("platform_settings")
            .select("value")
            .eq("key", ORG_NAV_LAYOUT_KEY)
            .maybeSingle<{ value: string }>(),
          supabase
            .from("admin_ui_preferences")
            .select("nav_layout")
            .maybeSingle<{ nav_layout: NavLayout | null }>(),
        ]);

        const org =
          orgRes.status === "fulfilled" ? parseLayout(orgRes.value.data?.value) : null;
        const user =
          userRes.status === "fulfilled"
            ? parseLayout(userRes.value.data?.nav_layout)
            : null;
        if (!cancelled) setLayout(user ?? org);
      } catch {
        if (!cancelled) setLayout(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { layout, ready };
}
