import { headers } from 'next/headers'

/**
 * Returns the effective site name for OpenGraph / Twitter metadata.
 *
 * On custom domains the "site" a visitor is on is the specific event, not
 * the host brand. When `x-custom-domain` is set by middleware and we have
 * an event title to hand, use that as the siteName so social previews
 * read e.g. "Andy's 50th" instead of "AutoDB". Falls back to the brand
 * name everywhere else.
 */
export async function resolveSiteName(
  brandName: string,
  eventTitle?: string | null,
): Promise<string> {
  const hdrs = await headers()
  if (hdrs.get('x-custom-domain') === 'true' && eventTitle) return eventTitle
  return brandName
}

/**
 * True when this request came through middleware as a custom domain
 * (either the legacy events.custom_domain path or the newer
 * custom_domains module path). Read from the `x-custom-domain` header
 * the middleware sets.
 */
export async function isCustomDomainRequest(): Promise<boolean> {
  const hdrs = await headers()
  return hdrs.get('x-custom-domain') === 'true'
}
