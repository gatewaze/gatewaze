/**
 * Known brand hostnames that are NOT custom domains.
 * Used on the client to detect if we're serving a white-label event site.
 */
const KNOWN_HOST_PATTERNS = ['gatewaze.io', 'localhost', 'vercel.app']

/**
 * Client-side check: is the current hostname a custom domain?
 * Returns false during SSR.
 */
export function isOnCustomDomain(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return !KNOWN_HOST_PATTERNS.some(pattern => host.includes(pattern))
}
