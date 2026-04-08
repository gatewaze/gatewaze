import { headers } from 'next/headers';

/**
 * Server-side utility to detect if the current request is on a custom domain.
 * Reads headers set by the middleware.
 */
export async function getCustomDomainContext() {
  const hdrs = await headers();
  const isCustomDomain = hdrs.get('x-custom-domain') === 'true';
  const contentType = hdrs.get('x-content-type') || null;
  const contentId = hdrs.get('x-content-id') || null;
  const customDomainHost = hdrs.get('x-custom-domain-host') || null;
  const pageTitle = hdrs.get('x-custom-domain-title') || null;
  const faviconUrl = hdrs.get('x-custom-domain-favicon') || null;

  return {
    isCustomDomain,
    contentType,
    contentId,
    customDomainHost,
    pageTitle,
    faviconUrl,
  };
}

/**
 * Rewrite an internal path for custom domain context.
 * When on a custom domain, strips the content prefix (e.g., /events/{slug}).
 *
 * Example:
 *   rewriteUrl('/events/abc123/agenda', 'events', 'abc123') → '/agenda'
 *   rewriteUrl('/events/abc123', 'events', 'abc123') → '/'
 *   rewriteUrl('/blog/my-post', 'blog', 'my-post') → '/'
 */
export function rewriteUrlForCustomDomain(
  path: string,
  contentType: string | null,
  contentSlug: string | null
): string {
  if (!contentType || !contentSlug) return path;

  // Map content type to its URL prefix
  const prefixMap: Record<string, string> = {
    events: '/events',
    event: '/events',
    blog: '/blog',
    newsletters: '/newsletters',
    newsletter: '/newsletters',
    recipes: '/recipes',
    recipe: '/recipes',
    cohorts: '/cohorts',
    competitions: '/competitions',
    structured_resources: '/resources',
  };

  const prefix = prefixMap[contentType];
  if (!prefix) return path;

  // Strip the content prefix + slug
  const fullPrefix = `${prefix}/${contentSlug}`;
  if (path.startsWith(fullPrefix)) {
    const remainder = path.slice(fullPrefix.length);
    return remainder || '/';
  }

  // Also handle when the path starts with just the prefix (top-level assignment)
  if (path.startsWith(prefix) && contentSlug === '__top_level__') {
    const remainder = path.slice(prefix.length);
    return remainder || '/';
  }

  return path;
}

/**
 * Build the full URL for a content item, using custom domain if available.
 *
 * @param basePath - The default path (e.g., /events/abc123)
 * @param customDomainHost - The custom domain hostname (e.g., dan-sarah.com), or null
 * @param subPath - Optional sub-path to append (e.g., /agenda)
 */
export function buildContentUrl(
  basePath: string,
  customDomainHost: string | null,
  subPath?: string
): string {
  if (customDomainHost) {
    const path = subPath ? `/${subPath.replace(/^\//, '')}` : '/';
    return `https://${customDomainHost}${path}`;
  }
  return subPath ? `${basePath}/${subPath.replace(/^\//, '')}` : basePath;
}
