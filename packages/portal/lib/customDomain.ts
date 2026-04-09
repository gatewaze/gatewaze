/**
 * Client-side check: is the current hostname a custom domain?
 *
 * A custom domain is any hostname that is NOT the platform's own portal.
 * We detect this by checking against the portal hostname configured in
 * NEXT_PUBLIC_APP_URL, the admin hostname, and common patterns.
 *
 * Returns false during SSR.
 */
export function isOnCustomDomain(): boolean {
  if (typeof window === 'undefined') return false

  const host = window.location.hostname

  // Known platform patterns (always NOT custom domains)
  if (host.includes('localhost')) return false
  if (host.includes('vercel.app')) return false
  if (host.includes('gatewaze.io')) return false
  if (host.includes('gatewaze.com')) return false

  // Check against configured portal hostname
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  if (appUrl) {
    try {
      const portalHost = new URL(appUrl).hostname
      if (host === portalHost) return false
      // Also check if it's a subdomain of the portal domain (e.g., admin.autodb.io)
      const portalDomain = portalHost.split('.').slice(-2).join('.')
      if (host.endsWith(portalDomain)) return false
    } catch { /* ignore invalid URL */ }
  }

  // If none of the above matched, this is a custom domain
  return true
}
