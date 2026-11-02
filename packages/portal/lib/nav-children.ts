/**
 * The pages a module page says lie beneath it.
 *
 * A module names an endpoint in its page metadata; the portal asks and
 * gets back a short list of labels and paths (the photo albums, say).
 * None of it is this portal's own data, so none of it is trusted: the
 * label is text and the path may only ever go deeper into the page that
 * declared it.
 */

export interface NavChild {
  label: string
  href: string
  count?: number
}

/** The most a page may list beneath it. */
const MAX_CHILDREN = 12
const MAX_LABEL = 40

/**
 * One path segment we are prepared to put in an address.
 *
 * Empty, "." and ".." are refused rather than encoded: encodeURIComponent
 * leaves them exactly as they are -- they are unreserved characters -- so
 * a path of "../../admin" would resolve out of the page it belongs to and
 * into somewhere else entirely.
 */
function safeSegment(part: string): string | null {
  if (part.length === 0 || part === '.' || part === '..') return null
  return encodeURIComponent(part)
}

/** The children of one page, from whatever its endpoint answered. */
export function navChildrenFrom(body: unknown, href: string): NavChild[] {
  const nav = (body as { nav?: unknown } | null)?.nav
  if (!Array.isArray(nav)) return []
  const out: NavChild[] = []
  for (const raw of nav) {
    if (out.length >= MAX_CHILDREN) break
    if (!raw || typeof raw !== 'object') continue
    const n = raw as { label?: unknown; path?: unknown; count?: unknown }
    if (typeof n.label !== 'string' || typeof n.path !== 'string') continue
    const label = n.label.trim().slice(0, MAX_LABEL)
    if (!label) continue
    const parts = n.path.split('/').map(safeSegment)
    if (parts.length === 0 || parts.some((p) => p === null)) continue
    out.push({
      label,
      href: `${href}/${parts.join('/')}`,
      count: typeof n.count === 'number' && Number.isFinite(n.count) ? n.count : undefined,
    })
  }
  return out
}

/**
 * An endpoint this portal is prepared to ask.
 *
 * Its own, and nobody else's: a module pointing this at another host
 * would have every visitor's browser announce the event to that host on
 * every page view.
 */
export function isOwnEndpoint(endpoint: string): boolean {
  return /^\/[^/]/.test(endpoint)
}

/**
 * Whether a page's endpoint says the page has anything on it.
 *
 * Used to decide whether to offer the page at all. A module page is
 * contributed to every event by its module being enabled, which is the
 * right unit for "is this feature switched on" and the wrong one for
 * "is there anything here": the Photos page appeared on all 994 AAIF
 * events the day the media module was enabled, every one of them empty
 * (reported 2026-10-13).
 *
 * Positive only. This returns true when it can SEE something, so an
 * endpoint that is missing, slow, unauthorised, rate-limited or
 * answering in a shape nobody here recognises leaves the page hidden
 * rather than offered. Hiding a page that does have content is a
 * recoverable disappointment; offering one that has none is the bug
 * being fixed.
 *
 * Shapes accepted, because modules answer in whichever suits them:
 *   { nav: [...] }     the children shape navChildrenFrom already reads
 *   { items: [...] }   a page of rows
 *   { photos: [...] } / { albums: [...] } / { videos: [...] }
 *   [ ... ]            a bare list
 *   { count: n } / { total: n }   a tally
 */
export function hasContentFrom(body: unknown): boolean {
  if (Array.isArray(body)) return body.length > 0
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>

  for (const key of ['nav', 'items', 'photos', 'albums', 'videos', 'results']) {
    const v = b[key]
    if (Array.isArray(v) && v.length > 0) return true
  }
  for (const key of ['count', 'total']) {
    const v = b[key]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return true
  }
  return false
}
