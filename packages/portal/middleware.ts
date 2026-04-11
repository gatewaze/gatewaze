import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSupabaseSession } from './lib/supabase/middleware'
import modulePrefixes from './lib/modules/generated-module-prefixes.json'

// Known brand hostnames that should pass through normally.
// Derived from PORTAL_HOST / ADMIN_HOST env vars (set per deployment),
// plus any extra hosts in KNOWN_HOSTS (comma-separated).
const KNOWN_HOSTS: string[] = (() => {
  const hosts = new Set<string>()
  const portalHost = process.env.PORTAL_HOST || process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, '')
  const adminHost = process.env.ADMIN_HOST || process.env.ADMIN_BASE_URL?.replace(/^https?:\/\//, '')
  if (portalHost) hosts.add(portalHost)
  if (adminHost) hosts.add(adminHost)
  const extra = process.env.KNOWN_HOSTS?.split(',').map(h => h.trim()).filter(Boolean)
  if (extra) extra.forEach(h => hosts.add(h))
  return Array.from(hosts)
})()

// Valid sub-paths under a custom domain event
const VALID_EVENT_SUBPATHS = ['/', '/agenda', '/speakers', '/sponsors', '/register', '/talks']

// Paths that should pass through without rewriting on custom domains
const PASSTHROUGH_PATHS = ['/sign-in', '/auth', '/privacy', '/terms', '/do-not-sell', '/cookie-policy', '/profile', '/api']

// Known region codes for path-based filter URLs
const KNOWN_REGION_CODES = new Set(['as', 'af', 'eu', 'na', 'sa', 'oc', 'on'])

// Well-known event type slugs (plural URL slug → singular DB value).
// Custom event types are handled by depluralizing unknown segments.
const EVENT_TYPE_SLUGS: Record<string, string> = {
  conferences: 'conference',
  meetups: 'meetup',
  workshops: 'workshop',
  webinars: 'webinar',
  hackathons: 'hackathon',
}

/** Attempt to de-pluralize a URL slug to get the singular DB value.
 *  Falls back to the slug as-is if no known rule applies. */
function slugToEventType(slug: string): string {
  // Check known slugs first
  if (slug in EVENT_TYPE_SLUGS) return EVENT_TYPE_SLUGS[slug]
  // De-pluralize: -ies → -y, -es → remove, -s → remove
  if (slug.endsWith('ies')) return slug.slice(0, -3) + 'y'
  if (slug.endsWith('shes') || slug.endsWith('ches')) return slug.slice(0, -2)
  if (slug.endsWith('ses')) return slug.slice(0, -2)
  if (slug.endsWith('s')) return slug.slice(0, -1)
  return slug
}

/** Check if a segment looks like a pluralized event type slug (ends in s, not a region) */
function isEventTypeSlug(seg: string): boolean {
  if (KNOWN_REGION_CODES.has(seg)) return false
  if (FILTER_VIEWS.has(seg)) return false
  return seg.endsWith('s') && seg.length > 2
}

// Views that support path-based filters
const FILTER_VIEWS = new Set(['upcoming', 'past', 'calendar', 'map'])

// Module prefixes with portal pages (generated at startup)
const modulePortalPrefixes = new Set<string>(modulePrefixes as string[])

// Cache for events module status
let eventsModuleStatus: { enabled: boolean; timestamp: number } | null = null
const MODULE_CACHE_TTL = 60 * 1000 // 60 seconds

async function isEventsModuleEnabled(): Promise<boolean> {
  // Check cache
  if (eventsModuleStatus && Date.now() - eventsModuleStatus.timestamp < MODULE_CACHE_TTL) {
    return eventsModuleStatus.enabled
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    // If we can't check, assume enabled for backward compatibility
    return true
  }

  try {
    const url = `${supabaseUrl}/rest/v1/installed_modules?select=status&id=eq.events&limit=1`
    const res = await fetch(url, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
    })

    if (!res.ok) {
      eventsModuleStatus = { enabled: true, timestamp: Date.now() }
      return true
    }

    const rows = await res.json()
    const enabled = rows?.[0]?.status === 'enabled'
    eventsModuleStatus = { enabled, timestamp: Date.now() }
    return enabled
  } catch {
    eventsModuleStatus = { enabled: true, timestamp: Date.now() }
    return true
  }
}

// In-memory cache for domain → event lookups (per-pod, resets on deploy)
const domainCache = new Map<string, { eventIdentifier: string; timestamp: number } | null>()
// In-memory cache for event identifier → canonical slug
const slugCache = new Map<string, { canonicalSlug: string; timestamp: number } | null>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function isKnownHost(hostname: string): boolean {
  if (KNOWN_HOSTS.includes(hostname)) return true
  if (hostname === 'localhost' || hostname.includes('localhost')) return true
  if (hostname.includes('vercel.app')) return true
  return false
}

// Content type to portal route mapping.
// Per spec-calendars-microsites §11.1, this should eventually be a
// generated file fed from module manifests (each module declares its
// contentTypes). For v1 we maintain the mapping inline here but every
// entry has a matching contentTypes declaration in the module's index.ts
// that the registry generator can pick up when the manifest-driven
// refactor lands (see Workstream 4).
const contentRouteMap: Record<string, (slug: string) => string> = {
  'events': (slug) => `/events/${slug}`,
  'event': (slug) => `/events/${slug}`,
  'blog': (slug) => `/blog/${slug}`,
  'newsletters': (slug) => `/newsletters/${slug}`,
  'newsletter': (slug) => `/newsletters/${slug}`,
  'recipes': (slug) => `/recipes/${slug}`,
  'recipe': (slug) => `/recipes/${slug}`,
  'cohorts': (slug) => `/cohorts/${slug}`,
  'competitions': (slug) => `/competitions/${slug}`,
  'structured_resources': (slug) => `/resources/${slug}`,
  // Added by spec-calendars-microsites.md §11.1
  'calendar': (slug) => `/calendars/${slug}`,
  'calendars': (slug) => `/calendars/${slug}`,
}

// Valid sub-paths per content type for custom-domain rewrites.
// Entries must match the module-owned portal routes.
const VALID_SUBPATHS_BY_CONTENT_TYPE: Record<string, string[]> = {
  event: ['/', '/agenda', '/speakers', '/sponsors', '/register', '/talks'],
  events: ['/', '/agenda', '/speakers', '/sponsors', '/register', '/talks'],
  calendar: ['/', '/about', '/events', '/media', '/chat', '/leaderboard', '/join', '/submit-talk'],
  calendars: ['/', '/about', '/events', '/media', '/chat', '/leaderboard', '/join', '/submit-talk'],
}

interface CustomDomainLookup {
  contentType: string
  contentSlug: string
  contentId: string
  pageTitle?: string
  faviconUrl?: string
}

// Cache for custom_domains table lookups
const customDomainCache = new Map<string, { result: CustomDomainLookup | null, timestamp: number }>()

async function lookupCustomDomain(hostname: string): Promise<CustomDomainLookup | null> {
  const cached = customDomainCache.get(hostname)
  if (cached !== undefined) {
    if (cached.result === null) return null
    if (Date.now() - cached.timestamp < CACHE_TTL) return cached.result
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null

  try {
    const url = `${supabaseUrl}/rest/v1/custom_domains?select=content_type,content_id,content_slug,page_title,favicon_url&domain=eq.${encodeURIComponent(hostname)}&status=eq.active&limit=1`
    const res = await fetch(url, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
    })

    if (!res.ok) {
      // Table might not exist (module not enabled) — that's fine
      customDomainCache.set(hostname, { result: null, timestamp: Date.now() })
      return null
    }

    const rows = await res.json()
    const row = rows?.[0]

    if (!row || !row.content_type) {
      customDomainCache.set(hostname, { result: null, timestamp: Date.now() })
      return null
    }

    const result: CustomDomainLookup = {
      contentType: row.content_type,
      contentSlug: row.content_slug || row.content_id || '',
      contentId: row.content_id || '',
      pageTitle: row.page_title || undefined,
      faviconUrl: row.favicon_url || undefined,
    }
    customDomainCache.set(hostname, { result, timestamp: Date.now() })
    return result
  } catch {
    customDomainCache.set(hostname, { result: null, timestamp: Date.now() })
    return null
  }
}

async function lookupEventByDomain(hostname: string): Promise<string | null> {
  // Check cache
  const cached = domainCache.get(hostname)
  if (cached !== undefined) {
    if (cached === null) return null
    if (Date.now() - cached.timestamp < CACHE_TTL) return cached.eventIdentifier
  }

  // Use internal URL for Docker, fall back to public URL
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null

  // Use plain fetch instead of @supabase/supabase-js to avoid Edge Runtime issues
  const url = `${supabaseUrl}/rest/v1/events?select=event_slug,event_id&custom_domain=eq.${encodeURIComponent(hostname)}&is_live_in_production=eq.true&limit=1`
  const res = await fetch(url, {
    headers: {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
  })

  if (!res.ok) {
    console.error(`Custom domain lookup failed for ${hostname}: ${res.status}`)
    domainCache.set(hostname, null)
    return null
  }

  const events = await res.json()
  const event = events?.[0]

  if (!event) {
    domainCache.set(hostname, null)
    return null
  }

  const identifier = event.event_slug || event.event_id
  domainCache.set(hostname, { eventIdentifier: identifier, timestamp: Date.now() })
  return identifier
}

async function lookupCanonicalSlug(identifier: string): Promise<string | null> {
  const cached = slugCache.get(identifier)
  if (cached !== undefined && cached !== null && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.canonicalSlug
  }

  // Use internal URL for Docker, fall back to public URL
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null

  // Extract potential event_id from end of slug (e.g., "ai-agents-summit-tk06c2" → "tk06c2")
  const extractedId = identifier.includes('-') ? identifier.split('-').pop()! : identifier

  // Single query: match by slug, event_id, or extracted event_id
  const orFilter = `event_slug.eq.${identifier},event_id.eq.${identifier}${extractedId !== identifier ? `,event_id.eq.${extractedId}` : ''}`
  const url = `${supabaseUrl}/rest/v1/events?select=event_slug&or=(${orFilter})&is_live_in_production=eq.true&limit=1`
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
    })

    if (!res.ok) {
      return null
    }

    const events = await res.json()
    const slug = events?.[0]?.event_slug

    if (!slug) {
      return null
    }

    slugCache.set(identifier, { canonicalSlug: slug, timestamp: Date.now() })
    return slug
  } catch (error) {
    console.error('[slug-redirect] fetch error:', error)
    return null
  }
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host')?.split(':')[0] || ''
  const pathname = request.nextUrl.pathname

  // Health check endpoint — always pass through for K8s probes
  if (pathname === '/api/health') {
    return NextResponse.next()
  }

  // Refresh Supabase auth session (syncs cookies for server components).
  // updateSupabaseSession mutates request.cookies so all downstream
  // NextResponse.next({ request }) calls will carry the refreshed tokens.
  if (!pathname.startsWith('/_next') && !pathname.startsWith('/api') && !/\.\w+$/.test(pathname)) {
    await updateSupabaseSession(request)
  }

  // Check events module status once (used in both known host and custom domain sections)
  const eventsEnabled = await isEventsModuleEnabled()

  // Pass through for known hosts — no custom domain logic needed
  if (isKnownHost(hostname)) {
    // Event-specific redirects only when events module is enabled
    if (eventsEnabled) {
      // Redirect legacy /calendar paths (e.g., /calendar, /calendar/eu, /calendar/eu/conferences/)
      if (pathname === '/calendar' || pathname.startsWith('/calendar/')) {
        const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean).slice(1) // remove 'calendar', strip trailing slash
        const url = request.nextUrl.clone()
        const filterParts: string[] = []
        for (const seg of segments) {
          if (KNOWN_REGION_CODES.has(seg) || isEventTypeSlug(seg)) {
            filterParts.push(seg)
          }
        }
        url.pathname = '/events/upcoming' + (filterParts.length > 0 ? '/' + filterParts.join('/') : '')
        return NextResponse.redirect(url, 301)
      }

      // Redirect old /event/ (singular) URLs to /events/ (plural) with canonical slug
      const legacyEventMatch = pathname.match(/^\/event\/([^/]+)(.*)$/)
      if (legacyEventMatch) {
        const [, identifier, rest] = legacyEventMatch
        const canonicalSlug = await lookupCanonicalSlug(identifier)
        const slug = canonicalSlug || identifier
        const url = request.nextUrl.clone()
        url.pathname = `/events/${slug}${rest}`
        return NextResponse.redirect(url, 301)
      }

      // Rewrite path-based filter URLs: /events/{view}/{region?}/{type?} → /events/{view}?region=...&type=...
      const filterMatch = pathname.match(/^\/events\/(upcoming|past|calendar|map)\/(.+)$/)
      if (filterMatch) {
        const [, view, rest] = filterMatch
        const segments = rest.replace(/\/+$/, '').split('/').filter(Boolean)
        let region: string | null = null
        let type: string | null = null
        for (const seg of segments) {
          if (!region && KNOWN_REGION_CODES.has(seg)) {
            region = seg
          } else if (!type && isEventTypeSlug(seg)) {
            type = slugToEventType(seg)
          }
        }
        if (region || type) {
          const url = request.nextUrl.clone()
          url.pathname = `/events/${view}`
          if (region) url.searchParams.set('region', region)
          if (type) url.searchParams.set('type', type)
          return NextResponse.rewrite(url)
        }
      }

      // Redirect to canonical slug if the URL identifier doesn't match
      const eventMatch = pathname.match(/^\/events\/([^/]+)(.*)$/)
      if (eventMatch) {
        const [, identifier, rest] = eventMatch
        const canonicalSlug = await lookupCanonicalSlug(identifier)
        if (canonicalSlug && canonicalSlug !== identifier) {
          const url = request.nextUrl.clone()
          url.pathname = `/events/${canonicalSlug}${rest}`
          return NextResponse.redirect(url)
        }
      }
    } else {
      // Events module disabled — let Next.js handle event paths (will hit not-found page)
      if (pathname.startsWith('/events') || pathname.startsWith('/event') || pathname === '/calendar' || pathname.startsWith('/calendar/')) {
        return NextResponse.next()
      }
    }

    // Legacy calendar sub-path redirects:
    // /calendars/[slug]/{upcoming,past,calendar,map} → /calendars/[slug]/events
    // These existed in the old core-baked calendar pages and are redirected to
    // the new module-owned events sub-page so existing bookmarks/SEO survive.
    const calLegacyMatch = pathname.match(/^\/calendars\/([^/]+)\/(upcoming|past|calendar|map)\/?$/)
    if (calLegacyMatch) {
      const [, slug, oldSubpath] = calLegacyMatch
      const url = request.nextUrl.clone()
      url.pathname = `/calendars/${slug}/events`
      // Preserve filter intent via query param so the events page can pre-filter
      if (oldSubpath === 'upcoming' || oldSubpath === 'past') {
        url.searchParams.set('filter', oldSubpath)
      } else if (oldSubpath === 'calendar' || oldSubpath === 'map') {
        url.searchParams.set('view', oldSubpath)
      }
      return NextResponse.redirect(url, { status: 301 })
    }

    // Rewrite module content pages: /blog/... → /m/blog/...
    const firstSegment = pathname.split('/')[1]
    if (firstSegment && modulePortalPrefixes.has(firstSegment)) {
      const url = request.nextUrl.clone()
      url.pathname = '/m' + pathname
      return NextResponse.rewrite(url)
    }

    return NextResponse.next()
  }

  // Static assets — pass through unchanged
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/theme') ||
    pathname.startsWith('/logos') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/js') ||
    pathname.startsWith('/rs/') ||
    pathname.startsWith('/policies') ||
    /\.(ico|png|jpg|jpeg|svg|css|js|woff|woff2|ttf|eot|map|webp|gif)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  // Try custom_domains table first (custom-domains module)
  const customDomain = await lookupCustomDomain(hostname)
  if (customDomain) {
    // Route based on content type
    const routeFn = contentRouteMap[customDomain.contentType]
    if (routeFn) {
      const targetPath = routeFn(customDomain.contentSlug)

      // RSVP paths: /rsvp/{code} passes through (short code lookup page exists)
      // /rsvp (with ?invite= query) rewrites to the event's RSVP page
      if (pathname.startsWith('/rsvp/') || pathname.startsWith('/i/')) {
        const requestHeaders = new Headers(request.headers)
        requestHeaders.set('x-custom-domain', 'true')
        requestHeaders.set('x-content-type', customDomain.contentType)
        requestHeaders.set('x-content-id', customDomain.contentId)
        requestHeaders.set('x-custom-domain-host', hostname)
        return NextResponse.next({ request: { headers: requestHeaders } })
      }
      if (pathname === '/rsvp') {
        // Rewrite /rsvp to /events/{slug}/rsvp so it renders inside the event layout
        const url = request.nextUrl.clone()
        url.pathname = `${targetPath}/rsvp`
        const requestHeaders = new Headers(request.headers)
        requestHeaders.set('x-custom-domain', 'true')
        requestHeaders.set('x-content-type', customDomain.contentType)
        requestHeaders.set('x-content-id', customDomain.contentId)
        requestHeaders.set('x-custom-domain-host', hostname)
        return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
      }

      // Passthrough paths (auth, legal, API, profile)
      const isPassthrough = PASSTHROUGH_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
      if (isPassthrough) {
        const requestHeaders = new Headers(request.headers)
        requestHeaders.set('x-custom-domain', 'true')
        requestHeaders.set('x-content-type', customDomain.contentType)
        requestHeaders.set('x-content-id', customDomain.contentId)
        requestHeaders.set('x-custom-domain-host', hostname)
        return NextResponse.next({ request: { headers: requestHeaders } })
      }

      // If the path already starts with the target content route (e.g., from a
      // middleware rewrite or direct access), pass through without double-rewriting
      if (pathname.startsWith(targetPath)) {
        const requestHeaders = new Headers(request.headers)
        requestHeaders.set('x-custom-domain', 'true')
        requestHeaders.set('x-content-type', customDomain.contentType)
        requestHeaders.set('x-content-id', customDomain.contentId)
        requestHeaders.set('x-custom-domain-host', hostname)
        return NextResponse.next({ request: { headers: requestHeaders } })
      }

      // Rewrite root and valid subpaths to the content route
      const url = request.nextUrl.clone()
      if (pathname === '/' || pathname === '') {
        url.pathname = targetPath
      } else {
        // Append subpath to the content route
        url.pathname = targetPath + pathname
      }
      const response = NextResponse.rewrite(url)
      response.headers.set('x-custom-domain', 'true')
      response.headers.set('x-content-type', customDomain.contentType)
      response.headers.set('x-content-id', customDomain.contentId)
      response.headers.set('x-custom-domain-host', hostname)
      if (customDomain.pageTitle) response.headers.set('x-custom-domain-title', customDomain.pageTitle)
      if (customDomain.faviconUrl) response.headers.set('x-custom-domain-favicon', customDomain.faviconUrl)
      return response
    }
  }

  // Fall back to legacy events.custom_domain lookup
  // If events module is disabled, custom domains can't resolve to events
  if (!eventsEnabled) {
    return NextResponse.redirect(new URL(process.env.NEXT_PUBLIC_APP_URL || '/'))
  }

  // Look up the event for this custom domain (legacy: events.custom_domain column)
  const eventIdentifier = await lookupEventByDomain(hostname)

  if (!eventIdentifier) {
    // Unknown domain with no matching event — redirect to main site
    return NextResponse.redirect(new URL(process.env.NEXT_PUBLIC_APP_URL || '/'))
  }

  // RSVP paths: pass through to /rsvp/[code] page with custom domain headers
  if (pathname.startsWith('/rsvp/') || pathname.startsWith('/i/')) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-custom-domain', 'true')
    requestHeaders.set('x-event-identifier', eventIdentifier)
    requestHeaders.set('x-custom-domain-host', hostname)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }
  if (pathname === '/rsvp') {
    // Rewrite /rsvp to /events/{slug}/rsvp so it renders inside the event layout
    const url = request.nextUrl.clone()
    url.pathname = `/events/${eventIdentifier}/rsvp`
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-custom-domain', 'true')
    requestHeaders.set('x-event-identifier', eventIdentifier)
    requestHeaders.set('x-custom-domain-host', hostname)
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  }

  // Passthrough paths (auth, legal pages, API, profile)
  const isPassthrough = PASSTHROUGH_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (isPassthrough) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-custom-domain', 'true')
    requestHeaders.set('x-event-identifier', eventIdentifier)
    requestHeaders.set('x-custom-domain-host', hostname)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Block access to other events
  if (pathname.startsWith('/events/')) {
    const requestedIdentifier = pathname.split('/')[2]
    if (requestedIdentifier !== eventIdentifier) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
    // Already correctly pathed — pass through with headers
    const response = NextResponse.next()
    response.headers.set('x-custom-domain', 'true')
    response.headers.set('x-event-identifier', eventIdentifier)
    response.headers.set('x-custom-domain-host', hostname)
    return response
  }

  // Map custom domain paths to event paths
  let rewritePath: string
  if (pathname === '/' || pathname === '') {
    rewritePath = `/events/${eventIdentifier}`
  } else if (VALID_EVENT_SUBPATHS.includes(pathname)) {
    rewritePath = `/events/${eventIdentifier}${pathname}`
  } else {
    // Unknown path — return 404 by rewriting to a non-existent route
    rewritePath = `/events/${eventIdentifier}${pathname}`
  }

  const url = request.nextUrl.clone()
  url.pathname = rewritePath

  const response = NextResponse.rewrite(url)
  response.headers.set('x-custom-domain', 'true')
  response.headers.set('x-event-identifier', eventIdentifier)
  response.headers.set('x-custom-domain-host', hostname)

  return response
}

export const config = {
  matcher: [
    // Match all paths except Next.js internals and static files
    '/((?!_next/static|_next/image).*)',
  ],
}
