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
