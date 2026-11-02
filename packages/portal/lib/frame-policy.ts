/**
 * Which sites may show portal pages inside a frame.
 *
 * Every portal response gets a `Content-Security-Policy: frame-ancestors`
 * header. Without one, any site could load a portal page in a hidden frame
 * and trick a signed-in visitor into clicking it (clickjacking).
 *
 *   - Embed pages (`/embed/...`, `/embed-auth`): this site plus the origins in
 *     EMBED_FRAME_ANCESTORS — the sites a brand puts portal widgets on.
 *   - Everything else: this site plus PORTAL_FRAME_ANCESTORS (normally empty;
 *     an escape hatch if a brand really does frame ordinary pages).
 *
 * Both are comma-separated origins, read at runtime so one image serves every
 * brand. An entry must be an https origin; a leading wildcard label is allowed
 * (`https://*.example.workers.dev`). Anything else is dropped, so a typo can
 * never widen the policy into `*`.
 */

const ORIGIN_RE = /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/

export function parseFrameOrigins(value: string | undefined | null): string[] {
  if (!value) return []
  const out: string[] = []
  for (const raw of value.split(',')) {
    const v = raw.trim().toLowerCase().replace(/\/+$/, '')
    if (ORIGIN_RE.test(v) && !out.includes(v)) out.push(v)
  }
  return out
}

export function isEmbedPath(pathname: string): boolean {
  return pathname === '/embed-auth' || pathname === '/embed' || pathname.startsWith('/embed/')
}

/** The frame-ancestors directive for a request path. */
export function frameAncestors(pathname: string, env: Record<string, string | undefined> = process.env): string {
  const extra = isEmbedPath(pathname)
    ? parseFrameOrigins(env.EMBED_FRAME_ANCESTORS)
    : parseFrameOrigins(env.PORTAL_FRAME_ANCESTORS)
  return ["frame-ancestors 'self'", ...extra].join(' ')
}
