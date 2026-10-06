/**
 * Reduce a user-influenced redirect target (query string, localStorage) to a
 * same-origin path, falling back to `/` for anything else.
 *
 * A relative path is accepted as-is. An absolute URL is accepted only when
 * its origin is in `allowedOrigins`, and is then reduced to its path, query
 * and hash: callers such as the calendar join flow build their `redirectTo`
 * from NEXT_PUBLIC_APP_URL, so absolute same-origin targets are normal.
 *
 * Backslashes and control characters in a relative path are rejected
 * outright rather than normalised: browsers treat `\` as `/` for http(s)
 * URLs and strip tabs and newlines before parsing, so `/\evil.example` and
 * `/\t/evil.example` both resolve to another host even though they start
 * with a single `/`. Dot segments are resolved before the final check so
 * `/.//evil.example` cannot yield a `//`-prefixed path either.
 */
export function sameOriginPath(value: string | null | undefined, allowedOrigins: readonly string[] = []): string {
  if (!value) return '/'

  if (/^https?:\/\//i.test(value)) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return '/'
    }
    if (!allowedOrigins.includes(url.origin)) return '/'
    return pathOf(url)
  }

  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return '/'
  return pathOf(new URL(value, 'http://placeholder.invalid'))
}

function pathOf(url: URL): string {
  if (url.pathname.startsWith('//')) return '/'
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The origins a portal redirect may point at: the page's own origin in the
 * browser, plus the configured public app URL (which can differ from the
 * current origin on custom domains). `requestOrigin` supplies the first on
 * the server, where there is no `window`.
 */
export function portalOrigins(requestOrigin?: string): string[] {
  const origins: string[] = []
  if (requestOrigin) origins.push(requestOrigin)
  if (typeof window !== 'undefined') origins.push(window.location.origin)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      origins.push(new URL(appUrl).origin)
    } catch {
      // A malformed NEXT_PUBLIC_APP_URL simply contributes no origin.
    }
  }
  return origins
}
