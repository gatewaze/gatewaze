/**
 * Storage path utilities.
 *
 * The platform persists relative storage paths (e.g. `people/42.png`) in the database
 * and resolves them to public URLs at read time using a configurable base URL
 * (`storage_bucket_url` platform setting). These utilities convert between the two
 * formats and are idempotent: calling them on already-converted values is a no-op.
 *
 * Design principles:
 * - Content-agnostic: no key-name heuristics. A string value is transformed only if its
 *   own shape matches (a storage URL on strip, a relative path on resolve).
 * - Idempotent: safe to apply during data-format transitions.
 * - Safe passthrough: external URLs, mailto/tel/data URIs, and root-relative page links
 *   (`/about-us`) are left unchanged.
 */

/** Matches Supabase's default public-object URL structure. */
const SUPABASE_STORAGE_URL_PATTERN =
  /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/[^/]+\/(.+)$/;

/** Matches strings that are already absolute URLs or URI schemes we should not rewrite. */
const ABSOLUTE_URL_PATTERN = /^(https?:|data:|mailto:|tel:|\/\/)/;

/**
 * Matches strings that plausibly look like a relative storage path:
 * folder(/subfolder)*\/filename.ext — no whitespace, has at least one slash,
 * ends in a short alphanumeric extension.
 *
 * Used by the resolve-side JSON walker to avoid accidentally rewriting arbitrary
 * text content (e.g., a caption that happens to be alphanumeric).
 */
const STORAGE_PATH_SHAPE = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+\.[a-zA-Z0-9]{1,8}$/;

/**
 * Strip a storage URL prefix from `value`, returning the relative path.
 * Passes through anything that is not a recognized storage URL (external URLs,
 * relative paths, empty strings).
 *
 * @param value - a string that may be a full storage URL or already a relative path
 * @param currentBucketUrl - optional base URL to strip (e.g. `https://cdn.example.com`);
 *   if provided, values starting with `${currentBucketUrl}/` are also stripped
 */
export function toStoragePath(
  value: string | null | undefined,
  currentBucketUrl?: string,
): string | null {
  if (value == null || value === '') return null;

  if (currentBucketUrl) {
    // The `+ '/'` enforces a directory boundary: `${currentBucketUrl}extra/file` must
    // NOT match — only values immediately under the bucket path are stripped.
    const prefix = currentBucketUrl.replace(/\/$/, '') + '/';
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }

  const match = SUPABASE_STORAGE_URL_PATTERN.exec(value);
  if (match) return match[1]!;

  return value;
}

/**
 * Build a full public URL from a relative storage path.
 * Passes through already-absolute URLs and root-relative links unchanged (idempotent).
 * Returns `null` for nullish/empty inputs and for paths containing `..` (traversal guard).
 *
 * @param path - a relative storage path like `people/42.png`, OR an already-full URL
 * @param bucketUrl - the configured storage base URL (no trailing slash required;
 *   defensive normalization handles it)
 */
export function toPublicUrl(
  path: string | null | undefined,
  bucketUrl: string,
): string | null {
  if (path == null || path === '') return null;

  // Already absolute (http, https, data:, mailto:, tel:, protocol-relative).
  if (ABSOLUTE_URL_PATTERN.test(path)) return path;

  // Root-relative page link (e.g. `/about-us`) — not a storage path.
  // Note the `//` check above already returned; here `/` alone means root-relative.
  if (path.startsWith('/')) return path;

  // Path traversal guard.
  if (path.includes('..')) {
    // eslint-disable-next-line no-console
    console.warn('[storage] toPublicUrl rejected path with traversal:', path);
    return null;
  }

  // Defensive slash normalization: even though setting validation forbids trailing
  // slashes on bucketUrl and a leading slash on the path shouldn't reach here,
  // protect against accidental `//` in the output.
  const base = bucketUrl.replace(/\/+$/, '');
  const rel = path.replace(/^\/+/, '');
  return `${base}/${rel}`;
}

/**
 * Return true iff `value` is a Supabase-style full storage URL.
 * Provided as a convenience for call sites that need the predicate; most callers
 * should use `toStoragePath(v) !== v` instead.
 */
export function isFullStorageUrl(value: string | null | undefined): boolean {
  if (value == null || value === '') return false;
  return SUPABASE_STORAGE_URL_PATTERN.test(value);
}

/**
 * Recursively walk any JSON-compatible value, applying `transformFn` to every
 * string. Objects and arrays are reconstructed (input is not mutated).
 * Non-string primitives (number, boolean, null) pass through unchanged.
 */
export function transformJsonStrings<T>(
  obj: T,
  transformFn: (value: string) => string,
): T {
  if (typeof obj === 'string') {
    return transformFn(obj) as unknown as T;
  }
  if (obj == null) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => transformJsonStrings(item, transformFn)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = transformJsonStrings(v, transformFn);
    }
    return out as unknown as T;
  }
  return obj;
}

/**
 * Strip storage URL prefixes from every string value in a JSON-compatible object.
 * External URLs, relative paths, and non-URL strings pass through unchanged.
 *
 * Additionally rewrites `<img src="...">` in HTML-containing string values so that
 * newsletter blocks with HTML-typed fields are handled correctly.
 */
export function stripStorageUrlsInJson<T>(obj: T, bucketUrl?: string): T {
  return transformJsonStrings(obj, (value) => {
    // If the value is HTML with embedded <img src="storage-url">, rewrite the srcs.
    if (value.includes('<img') && value.includes('src=')) {
      value = rewriteImgSrcToStoragePath(value, bucketUrl);
    }
    // Then normalize the value itself (handles plain-string URL fields).
    const stripped = toStoragePath(value, bucketUrl);
    return stripped ?? value;
  });
}

/**
 * Resolve relative storage paths to full URLs within a JSON-compatible object.
 * Only values matching a plausible storage-path shape are rewritten — arbitrary text
 * content (captions, descriptions, page links) passes through unchanged.
 *
 * Additionally rewrites `<img src="relative/path">` in HTML-containing string values.
 */
export function resolveStoragePathsInJson<T>(obj: T, bucketUrl: string): T {
  return transformJsonStrings(obj, (value) => {
    if (value.includes('<img') && value.includes('src=')) {
      value = rewriteImgSrcToPublicUrl(value, bucketUrl);
    }
    // Only resolve if the string looks like a plausible storage path. This guards
    // against wrapping arbitrary text as URLs.
    if (!STORAGE_PATH_SHAPE.test(value)) return value;
    const resolved = toPublicUrl(value, bucketUrl);
    return resolved ?? value;
  });
}

/**
 * Rewrite all `<img src="...">` attributes in an HTML string, stripping any
 * full storage URL to its relative path. Preserves the rest of the HTML verbatim.
 */
export function rewriteImgSrcToStoragePath(html: string, bucketUrl?: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)(")/gi,
    (_match, before, src, after) => {
      const path = toStoragePath(src, bucketUrl);
      return `${before}${path ?? src}${after}`;
    },
  );
}

/**
 * Rewrite all `<img src="...">` attributes in an HTML string, resolving any
 * relative storage path to its full URL. Preserves the rest of the HTML verbatim.
 */
export function rewriteImgSrcToPublicUrl(html: string, bucketUrl: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)(")/gi,
    (_match, before, src, after) => {
      const url = toPublicUrl(src, bucketUrl);
      return `${before}${url ?? src}${after}`;
    },
  );
}

/**
 * Compute the effective storage bucket URL.
 *
 * Preference order:
 *   1. `configured` if non-empty
 *   2. `${supabaseUrl}/storage/v1/object/public/media` (runtime fallback)
 *
 * If an `allowedHosts` list is supplied and the configured value's hostname is not
 * in the list, the runtime fallback is used instead (defense-in-depth for the
 * admin-editable `storage_bucket_url` setting).
 *
 * @returns the effective URL and a flag indicating whether the fallback was used
 */
export function resolveBucketUrl(params: {
  configured: string | null | undefined;
  supabaseUrl: string;
  allowedHosts?: string[];
}): { url: string; usedFallback: boolean; allowlistRejected: boolean } {
  const { configured, supabaseUrl, allowedHosts } = params;
  const fallback = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/media`;

  if (!configured) {
    return { url: fallback, usedFallback: true, allowlistRejected: false };
  }

  if (allowedHosts && allowedHosts.length > 0) {
    try {
      const host = new URL(configured).hostname.toLowerCase();
      const normalized = allowedHosts.map((h) => h.trim().toLowerCase());
      if (!normalized.includes(host)) {
        return { url: fallback, usedFallback: true, allowlistRejected: true };
      }
    } catch {
      // Unparseable URL — treat as allowlist-rejected for safety.
      return { url: fallback, usedFallback: true, allowlistRejected: true };
    }
  }

  return { url: configured, usedFallback: false, allowlistRejected: false };
}
