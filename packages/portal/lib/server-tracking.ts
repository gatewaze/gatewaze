/**
 * Server-side tracker for portal route handlers.
 *
 * Wraps @gatewaze/tracking/server with the portal's wiring: the
 * analytics module's ingest lives on the API host, the portal property
 * is discovered from /a/portal-config (cached), and per-request context
 * (ip, UA, origin, anonymous-id cookie) is lifted straight off the
 * NextRequest so backend events join the visitor's browser session.
 *
 * Usage in a route handler:
 *   const { tracker, context, anonymousId } = getRequestTracking(req)
 *   void tracker.track('RSVP Submitted', { properties, anonymousId, context })
 *
 * Fire-and-forget (`void`) — the SDK never throws, and a tracking
 * failure must never fail the request.
 */

import type { NextRequest } from 'next/server'
import { anonymousIdFromCookieHeader } from '@gatewaze/tracking'
import { createServerTracker, type ServerTracker } from '@gatewaze/tracking/server'
import type { TrackContext } from '@gatewaze/tracking'

const API_URL = (
  process.env.GATEWAZE_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  ''
).replace(/\/+$/, '')

let tracker: ServerTracker | null = null

export function getServerTracker(): ServerTracker {
  tracker ??= createServerTracker({
    collectUrl: API_URL ? `${API_URL}/a/collect` : undefined,
    portalConfigUrl: API_URL ? `${API_URL}/a/portal-config` : undefined,
    segmentWriteKey: process.env.SEGMENT_WRITE_KEY || undefined,
    logger: { warn: (msg, meta) => console.warn(`[tracking] ${msg}`, meta ?? '') },
  })
  return tracker
}

/** Build the per-event context + anonymous id from an incoming request. */
export function getRequestTracking(req: NextRequest): {
  tracker: ServerTracker
  anonymousId: string | null
  context: TrackContext
} {
  const referer = req.headers.get('referer')
  let url: string | null = null
  try {
    url = referer ? new URL(referer).pathname : null
  } catch {
    /* unparsable referer */
  }
  return {
    tracker: getServerTracker(),
    anonymousId: anonymousIdFromCookieHeader(req.headers.get('cookie')),
    context: {
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: req.headers.get('user-agent'),
      // The portal's own origin — matches the property domains allowlist.
      origin: req.headers.get('origin') || (req.headers.get('host') ? `${req.nextUrl.protocol}//${req.headers.get('host')}` : null),
      url,
    },
  }
}
