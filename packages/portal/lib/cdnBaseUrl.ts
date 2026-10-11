/**
 * Resolve a brand's Bunny CDN pull-zone origin from environment.
 *
 * Kept as a pure function over an env-like object so it can be tested without
 * touching `process.env` or resetting modules. `config/brand.ts` calls it with
 * `process.env` and puts the result on `brandConfig.cdnBaseUrl`.
 */

type EnvLike = Record<string, string | undefined>;

/**
 * Returns the pull zone's ORIGIN, or '' when the brand has no usable zone.
 *
 * Reads `BUNNY_PULLZONE_URL` / `BUNNY_CDN_ENABLED` — the names already set on
 * the AAIF and autodb brands and consumed by the admin package. The
 * `NEXT_PUBLIC_` variants are accepted as a fallback because
 * `k8s/values-example.yaml` documents both spellings, but they are not relied
 * on: a `NEXT_PUBLIC_` value is inlined at build time, and a brand's zone is
 * not known then.
 *
 * Only the origin survives. An operator who pastes a URL with a path, a query
 * or credentials does not get those smuggled into every image URL on the page.
 * Anything unparseable yields '' so the caller falls back cleanly rather than
 * emitting a broken `<img src>`.
 */
export function resolveCdnBaseUrl(env: EnvLike): string {
  const enabled = (env.BUNNY_CDN_ENABLED ?? env.NEXT_PUBLIC_BUNNY_CDN_ENABLED) === 'true';
  if (!enabled) return '';

  const raw = env.BUNNY_PULLZONE_URL || env.NEXT_PUBLIC_BUNNY_PULLZONE_URL || '';
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}
