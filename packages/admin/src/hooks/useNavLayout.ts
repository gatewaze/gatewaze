import { useCallback, useEffect, useState } from "react";
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
  /**
   * Set when either layer failed to load. `layout` then holds whatever did
   * load (possibly null), so it may not be the layout the user really has.
   * The sidebar ignores this and falls back quietly; a page that would
   * mislead without the layout, such as a hub page, should show it.
   */
  error: Error | null;
  /** Re-run both reads. */
  reload: () => void;
}

function failure(res: PromiseSettledResult<{ error: unknown }>): Error | null {
  if (res.status === "rejected") {
    return res.reason instanceof Error ? res.reason : new Error(String(res.reason));
  }
  const err = res.value.error;
  if (!err) return null;
  const message = (err as { message?: unknown }).message;
  return new Error(typeof message === "string" ? message : "Failed to load navigation layout");
}

/**
 * Loads the effective admin nav layout. The per-user override (RLS-scoped to
 * the caller) wins over the org-wide default; absence of both yields `null`,
 * which the resolver treats as "use module defaults".
 */
export function useNavLayout(): UseNavLayoutResult {
  const [layout, setLayout] = useState<NavLayout | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

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
        if (!cancelled) {
          setLayout(user ?? org);
          setError(failure(orgRes) ?? failure(userRes));
        }
      } catch (err) {
        if (!cancelled) {
          setLayout(null);
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { layout, ready, error, reload };
}
