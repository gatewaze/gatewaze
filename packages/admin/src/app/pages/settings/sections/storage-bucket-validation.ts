import { supabase } from "@/lib/supabase";

/**
 * Storage-bucket-URL validation extracted from StorageSettings.tsx so the
 * component file only exports React components — keeping fast refresh
 * happy. See `specs/spec-relative-storage-paths.md` for the full design.
 *
 * Validation is intentionally strict:
 * - HTTPS required (TLS).
 * - No trailing slash, no query params, no fragment.
 * - Hostname must be in the server-side `ALLOWED_STORAGE_DOMAINS` env var
 *   (enforced at save time via the API; enforced again at runtime in the
 *   portal brand config).
 */

const CLIENT_URL_PATTERN = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^/?#\s]+)*$/i;

/**
 * Validate a `storage_bucket_url` value against the server-side allow-list.
 * Returns null on success, or an error message on failure. Empty strings
 * are accepted (they trigger the runtime fallback to
 * `${SUPABASE_URL}/storage/v1/object/public/media`).
 *
 * If the server-side edge function isn't deployed (404), falls back to
 * client-side URL shape validation only. The portal's runtime
 * allow-list check (in BrandConfig resolution) is the authoritative
 * security gate — this admin check is the first of two defense-in-depth
 * layers.
 */
export async function validateStorageBucketUrl(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (trimmed === "") return null;

  // Client-side shape check first — cheap, catches typos before the network call.
  if (!CLIENT_URL_PATTERN.test(trimmed)) {
    return "URL must be HTTPS with no trailing slash, query string, or fragment.";
  }
  if (trimmed.endsWith("/")) {
    return "Remove the trailing slash.";
  }

  // Server-side allow-list check (defense-in-depth).
  try {
    const { data, error } = await supabase.functions.invoke(
      "settings-storage-bucket-url?op=validate",
      { body: { url: trimmed } },
    );
    if (error) {
      // If the function isn't deployed yet, accept the save but warn — the
      // portal's runtime check will reject if the hostname is outside
      // ALLOWED_STORAGE_DOMAINS.
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("404") || msg.includes("not found") || msg.includes("failed to fetch")) {
        console.warn(
          "[storage] Server-side validation endpoint unavailable; relying on runtime allow-list",
        );
        return null;
      }
      return error.message ?? "Validation failed";
    }
    const body = data as { ok: boolean; error?: string };
    if (!body.ok) return body.error ?? "Validation failed";
    return null;
  } catch (err) {
    // Same graceful fallback for network-level failures.
    console.warn("[storage] Server-side validation failed, relying on runtime allow-list:", err);
    return null;
  }
}
