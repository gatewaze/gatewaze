import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { headers } from 'next/headers'

/**
 * API route to create tracking sessions with IP address capture
 *
 * This server-side route allows us to capture the user's IP address,
 * which is not accessible from client-side JavaScript.
 */

interface TrackingSessionRequest {
  brandId: string
  eventId?: string
  sessionId: string
  clickIds: Record<string, string>
  platformCookies: Record<string, string>
  utmParams: Record<string, string>
  referrer: string
  landingPage: string
  userAgent: string
  emailHash?: string
  hasConsent: boolean
  consentedPlatforms: string[]
  expiresAt: string
}

/**
 * Extract client IP from various headers
 * Checks multiple headers used by different proxies/CDNs
 */
function getClientIp(headersList: Headers): string | null {
  // Cloudflare
  const cfConnectingIp = headersList.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp

  // Vercel / Generic proxy
  const xForwardedFor = headersList.get('x-forwarded-for')
  if (xForwardedFor) {
    // x-forwarded-for can contain multiple IPs, the first is the client
    const firstIp = xForwardedFor.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  // Fly.io
  const flyClientIp = headersList.get('fly-client-ip')
  if (flyClientIp) return flyClientIp

  // AWS ALB
  const xClientIp = headersList.get('x-client-ip')
  if (xClientIp) return xClientIp

  // Real IP (nginx)
  const xRealIp = headersList.get('x-real-ip')
  if (xRealIp) return xRealIp

  return null
}

export async function POST(request: NextRequest) {
  try {
    const body: TrackingSessionRequest = await request.json()
    const headersList = await headers()

    // Extract IP address from request headers
    const ipAddress = getClientIp(headersList)

    const supabase = await createServerSupabase(body.brandId)

    const { data, error } = await supabase
      .from('integrations_ad_tracking_sessions')
      .insert({
        session_id: body.sessionId,
        brand_id: body.brandId,
        event_id: body.eventId || null,
        click_ids: body.clickIds,
        platform_cookies: body.platformCookies,
        utm_source: body.utmParams.utm_source || null,
        utm_medium: body.utmParams.utm_medium || null,
        utm_campaign: body.utmParams.utm_campaign || null,
        utm_content: body.utmParams.utm_content || null,
        utm_term: body.utmParams.utm_term || null,
        referrer: body.referrer || null,
        landing_page: body.landingPage,
        user_agent: body.userAgent,
        ip_address: ipAddress,
        email_hash: body.emailHash || null,
        tracking_consent: body.hasConsent,
        consent_timestamp: body.hasConsent ? new Date().toISOString() : null,
        consented_platforms: body.consentedPlatforms,
        expires_at: body.expiresAt,
      })
      .select('id, session_id, event_id')
      .single()

    if (error) {
      console.error('Failed to create tracking session:', error)
      return NextResponse.json(
        { error: 'Failed to create tracking session' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      id: data.id,
      sessionId: data.session_id,
      eventId: data.event_id,
    })
  } catch (err) {
    console.error('Error in tracking session API:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
