// Path handling for the games origin.
//
// Two rules make this safe, and both are enforced here:
//   1. A URL path is NEVER concatenated onto a storage key. It is normalised to
//      a repo-relative path and then looked up in the version manifest; only a
//      manifest hit produces a storage key (built from the DB `storage_prefix`).
//   2. Normalisation is deny-by-default: anything that is not a plain relative
//      path of plain segments is rejected outright rather than "cleaned up".

export const SLUG_RE = /^[a-z][a-z0-9-]{1,60}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A `%XX` escape surviving one decode pass — i.e. the input was double-encoded. */
const RESIDUAL_ESCAPE_RE = /%[0-9a-fA-F]{2}/;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:/;

// Built from char codes so the literal bytes are unambiguous in source review.
const NUL = String.fromCharCode(0);
const BACKSLASH = String.fromCharCode(92);

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

export function isValidVersionId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Normalise a raw (still percent-encoded) URL asset path to a repo-relative
 * manifest path, or null if it is not safely representable.
 *
 * Each segment is decoded exactly once and then validated. A segment that still
 * contains an escape, a separator, a traversal marker, a backslash, a null byte
 * or any control character is rejected — we never re-decode and never collapse
 * `..`, because collapsing is how traversal bugs are born.
 */
export function normaliseAssetPath(rawPath: string): string | null {
  if (rawPath.length === 0) return null;
  if (rawPath.length > 1024) return null;

  // Absolute paths, backslashes and null bytes are rejected before decoding so
  // that no encoded form can smuggle them past this check either.
  if (rawPath.startsWith('/') || rawPath.startsWith(BACKSLASH)) return null;
  if (rawPath.includes(BACKSLASH) || rawPath.includes(NUL)) return null;
  if (hasControlChar(rawPath)) return null;

  const segments = rawPath.split('/');
  const out: string[] = [];

  for (const rawSegment of segments) {
    if (rawSegment.length === 0) return null; // empty or duplicated separator

    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return null; // malformed escape
    }

    if (segment.length === 0) return null;
    if (segment === '.' || segment === '..') return null;
    if (segment.includes('/') || segment.includes(BACKSLASH)) return null; // %2f / %5c
    if (segment.includes(NUL)) return null; // %00
    if (hasControlChar(segment)) return null;
    if (RESIDUAL_ESCAPE_RE.test(segment)) return null; // double-encoded input
    if (segment.includes('..')) return null; // no traversal marker survives, in any position
    if (WINDOWS_DRIVE_RE.test(segment)) return null;

    out.push(segment);
  }

  return out.join('/');
}

/**
 * Normalise a path recorded in the manifest. Manifest paths are written by the
 * sync worker and are already repo-relative; this only strips a leading `./`
 * and rejects anything that would be unaddressable via a URL.
 */
export function normaliseManifestPath(recorded: unknown): string | null {
  if (typeof recorded !== 'string' || recorded.length === 0) return null;
  const trimmed = recorded.startsWith('./') ? recorded.slice(2) : recorded;
  if (trimmed.startsWith('/') || trimmed.includes(BACKSLASH) || trimmed.includes(NUL)) return null;
  if (hasControlChar(trimmed)) return null;
  const segments = trimmed.split('/');
  if (segments.some((s) => s.length === 0 || s === '.' || s === '..')) return null;
  return segments.join('/');
}

export type Route =
  | { kind: 'health' }
  | { kind: 'ready' }
  | { kind: 'metrics' }
  | { kind: 'sdk' }
  | { kind: 'live'; slug: string }
  | { kind: 'version'; slug: string; versionId: string; assetPath: string }
  | { kind: 'redirect-slash'; to: string }
  | { kind: 'none' };

/**
 * Map a request path to a route. Everything not listed is `none` — this origin
 * serves games, the SDK and the three operational endpoints, nothing else
 * (spec §3, normative).
 */
export function matchRoute(pathname: string): Route {
  if (pathname === '/healthz') return { kind: 'health' };
  if (pathname === '/readyz') return { kind: 'ready' };
  if (pathname === '/metrics') return { kind: 'metrics' };
  if (pathname === '/sdk/gatewaze-arcade-1.js') return { kind: 'sdk' };

  if (!pathname.startsWith('/g/')) return { kind: 'none' };

  const rest = pathname.slice('/g/'.length);
  const parts = rest.split('/');
  const slug = parts[0] ?? '';
  if (!isValidSlug(slug)) return { kind: 'none' };

  // `/g/<slug>` → canonicalise to the trailing-slash form so relative asset
  // URLs inside the game resolve against the game directory.
  if (parts.length === 1) return { kind: 'redirect-slash', to: `/g/${slug}/` };
  if (parts.length === 2 && parts[1] === '') return { kind: 'live', slug };

  if (parts[1] !== 'v') return { kind: 'none' };

  const versionId = parts[2] ?? '';
  if (!isValidVersionId(versionId)) return { kind: 'none' };

  if (parts.length === 3) return { kind: 'redirect-slash', to: `/g/${slug}/v/${versionId.toLowerCase()}/` };

  const assetPath = parts.slice(3).join('/');
  return { kind: 'version', slug, versionId: versionId.toLowerCase(), assetPath };
}
