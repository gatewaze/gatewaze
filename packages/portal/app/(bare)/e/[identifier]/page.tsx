import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { extractEventIdFromSlug } from '@/lib/slugify'
import { CLICK_ID_PARAMS, UTM_PARAMS } from '@/config/platforms'

interface Props {
  params: Promise<{ identifier: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

interface EventForRedirect {
  event_id: string
  event_slug: string | null
  event_title: string
  event_link: string | null
}

async function getEventForRedirect(identifier: string, brandId: string): Promise<EventForRedirect | null> {
  const supabase = await createServerSupabase(brandId)

  let { data: event } = await supabase
    .from('events')
    .select('event_id, event_slug, event_title, event_link')
    .eq('event_slug', identifier)
    .eq('is_live_in_production', true)
    .maybeSingle()

  if (!event) {
    const result = await supabase
      .from('events')
      .select('event_id, event_slug, event_title, event_link')
      .eq('event_id', identifier)
      .eq('is_live_in_production', true)
      .maybeSingle()
    event = result.data
  }

  // Fallback: extract event_id from end of slug (handles stale/modified slugs)
  if (!event && identifier.includes('-')) {
    const extractedId = extractEventIdFromSlug(identifier)
    if (extractedId !== identifier) {
      const result = await supabase
        .from('events')
        .select('event_id, event_slug, event_title, event_link')
        .eq('event_id', extractedId)
        .eq('is_live_in_production', true)
        .maybeSingle()
      event = result.data
    }
  }

  return event
}

/**
 * Parse tracking parameters from search params (server-side equivalent of captureTrackingParams)
 */
function parseTrackingParams(searchParams: Record<string, string | string[] | undefined>) {
  const clickIds: Record<string, string> = {}
  const utmParams: Record<string, string> = {}

  for (const [, param] of Object.entries(CLICK_ID_PARAMS)) {
    const value = searchParams[param]
    if (typeof value === 'string') clickIds[param] = value
  }

  for (const param of UTM_PARAMS) {
    const value = searchParams[param]
    if (typeof value === 'string') utmParams[param] = value
  }

  return { clickIds, utmParams }
}

/**
 * Extract client IP from request headers
 * Checks multiple headers used by different proxies/CDNs
 */
function getClientIp(reqHeaders: Headers): string | null {
  // Cloudflare
  const cfConnectingIp = reqHeaders.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp

  // Vercel / Generic proxy
  const xForwardedFor = reqHeaders.get('x-forwarded-for')
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  // Fly.io
  const flyClientIp = reqHeaders.get('fly-client-ip')
  if (flyClientIp) return flyClientIp

  // AWS ALB
  const xClientIp = reqHeaders.get('x-client-ip')
  if (xClientIp) return xClientIp

  // Real IP (nginx)
  const xRealIp = reqHeaders.get('x-real-ip')
  if (xRealIp) return xRealIp

  return null
}

/**
 * Determine ad platform from click ID parameters
 */
function getPlatform(clickIds: Record<string, string>): string | undefined {
  for (const [platform, param] of Object.entries(CLICK_ID_PARAMS)) {
    if (clickIds[param]) return platform
  }
  return undefined
}

/**
 * Build the redirect URL with UTM params and tracking session ID.
 * Encodes the session ID into utm_source as {platform}__{session_id} so that
 * Luma persists it in the custom_source CSV column for conversion attribution.
 */
function buildRedirectUrl(
  eventLink: string,
  trackingParams: { clickIds: Record<string, string>; utmParams: Record<string, string> },
  sessionId: string | null
): string {
  const url = new URL(eventLink)

  const platform = getPlatform(trackingParams.clickIds)

  if (sessionId && platform) {
    url.searchParams.set('utm_source', `${platform}__${sessionId}`)
  } else if (sessionId) {
    url.searchParams.set('utm_source', `direct__${sessionId}`)
  } else if (trackingParams.utmParams.utm_source) {
    url.searchParams.set('utm_source', trackingParams.utmParams.utm_source)
  }

  if (trackingParams.utmParams.utm_medium) {
    url.searchParams.set('utm_medium', trackingParams.utmParams.utm_medium)
  }
  if (trackingParams.utmParams.utm_campaign) {
    url.searchParams.set('utm_campaign', trackingParams.utmParams.utm_campaign)
  }

  if (sessionId) {
    url.searchParams.set('utm_content', sessionId)
  } else if (trackingParams.utmParams.utm_content) {
    url.searchParams.set('utm_content', trackingParams.utmParams.utm_content)
  }

  if (trackingParams.utmParams.utm_term) {
    url.searchParams.set('utm_term', trackingParams.utmParams.utm_term)
  }

  return url.toString()
}

export default async function TrackingRedirectPage({ params, searchParams }: Props) {
  const { identifier } = await params
  const resolvedSearchParams = await searchParams
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEventForRedirect(identifier, brand)

  if (!event || !event.event_link) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Event Not Found</h1>
          <p className="text-gray-600 mb-4">
            {!event ? 'This event could not be found or is no longer available.' : 'This event does not have a registration link.'}
          </p>
          <a
            href={`https://${brandConfig.domain}`}
            className="inline-block px-6 py-3 text-white font-semibold rounded-lg shadow-md hover:shadow-xl hover:brightness-110 transition-all duration-200"
            style={{
              backgroundColor: brandConfig.primaryColor,
              borderColor: brandConfig.primaryColor,
              borderWidth: '3px',
              borderStyle: 'solid',
              boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.5), 0 4px 6px -1px rgba(0, 0, 0, 0.1)`,
            }}
          >
            Go to {brandConfig.name}
          </a>
        </div>
      </div>
    )
  }

  // Parse tracking params from URL search params
  const trackingParams = parseTrackingParams(resolvedSearchParams)
  const hasTrackingParams =
    Object.keys(trackingParams.clickIds).length > 0 ||
    Object.keys(trackingParams.utmParams).length > 0

  // Create tracking session server-side (non-blocking — don't let failures prevent redirect)
  let sessionId: string | null = null
  if (hasTrackingParams) {
    try {
      const supabase = await createServerSupabase(brand)
      const reqHeaders = await headers()
      const ts = Date.now().toString(36)
      const rand = Math.random().toString(36).substring(2, 10)
      sessionId = `${ts}-${rand}`

      // Extract IP address from request headers
      const ipAddress = getClientIp(reqHeaders)

      await supabase
        .from('ad_tracking_sessions')
        .insert({
          session_id: sessionId,
          brand_id: brand,
          event_id: event.event_id,
          click_ids: trackingParams.clickIds,
          platform_cookies: {},
          utm_source: trackingParams.utmParams.utm_source || null,
          utm_medium: trackingParams.utmParams.utm_medium || null,
          utm_campaign: trackingParams.utmParams.utm_campaign || null,
          utm_content: trackingParams.utmParams.utm_content || null,
          utm_term: trackingParams.utmParams.utm_term || null,
          referrer: reqHeaders.get('referer') || null,
          landing_page: null,
          user_agent: reqHeaders.get('user-agent') || null,
          ip_address: ipAddress,
          tracking_consent: true,
          consent_timestamp: new Date().toISOString(),
          consented_platforms: Object.keys(CLICK_ID_PARAMS),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          external_redirect_at: new Date().toISOString(),
        })
    } catch (err) {
      console.error('Failed to create tracking session:', err)
      sessionId = null
    }
  }

  // Build redirect URL and redirect immediately (HTTP 307)
  const redirectUrl = buildRedirectUrl(event.event_link, trackingParams, sessionId)
  redirect(redirectUrl)
}
