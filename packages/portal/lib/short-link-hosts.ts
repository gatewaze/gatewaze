/**
 * Short-link-only hosts (e.g. go.mlops.community, migrated from Short.io).
 *
 * Gatewaze serves short links at `/go/<slug>` on the portal host, but a
 * domain inherited from a link shortener has years of links in the wild at
 * `/<slug>`. For hosts listed in SHORT_LINK_HOSTS the middleware rewrites
 * `/<slug>` → `/go/<slug>` and sends `/` to the host's home URL, so every
 * existing link keeps resolving. The /go route still scopes slugs by Host.
 *
 * SHORT_LINK_HOSTS format: comma-separated `host` or `host=https://home.url`
 * entries. Without a home URL the bare host 404s.
 */

export interface ShortLinkHost {
  host: string
  homeUrl: string | null
}

/** Same charset as the /go route and POST /api/redirects/create-bulk. */
export const SHORT_LINK_SLUG_RE = /^[A-Za-z0-9._~&+()[\]-]{1,80}$/

export function parseShortLinkHosts(raw: string | undefined): Map<string, ShortLinkHost> {
  const hosts = new Map<string, ShortLinkHost>()
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    const host = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim().toLowerCase()
    const home = eq === -1 ? '' : trimmed.slice(eq + 1).trim()
    if (!/^[a-z0-9.-]+$/.test(host)) continue
    let homeUrl: string | null = null
    if (home) {
      try {
        const u = new URL(home)
        if (u.protocol === 'https:' || u.protocol === 'http:') homeUrl = u.toString()
      } catch {
        /* invalid home URL — treat as none */
      }
    }
    hosts.set(host, { host, homeUrl })
  }
  return hosts
}

export type ShortLinkAction =
  | { kind: 'home'; url: string }
  | { kind: 'rewrite'; pathname: string }
  | { kind: 'not-found' }

/**
 * Decide what a short-link-only host does with a request path.
 * `pathname` is the raw (still percent-encoded) URL path.
 */
export function resolveShortLinkPath(entry: ShortLinkHost, pathname: string): ShortLinkAction {
  if (pathname === '/' || pathname === '') {
    return entry.homeUrl ? { kind: 'home', url: entry.homeUrl } : { kind: 'not-found' }
  }
  const segment = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!segment || segment.includes('/')) return { kind: 'not-found' }
  let slug: string
  try {
    slug = decodeURIComponent(segment)
  } catch {
    return { kind: 'not-found' }
  }
  if (!SHORT_LINK_SLUG_RE.test(slug)) return { kind: 'not-found' }
  return { kind: 'rewrite', pathname: `/go/${segment}` }
}
