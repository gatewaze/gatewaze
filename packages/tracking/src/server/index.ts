/**
 * Node SDK — backend events from Next route handlers, the Express API,
 * or workers.
 *
 * createServerTracker() returns a tracker that fans each event out to:
 *   1. the analytics module's first-party store, via its public
 *      POST /a/collect ingest (property discovered lazily from
 *      GET /a/portal-config when not configured explicitly), and
 *   2. Segment's HTTP API, when a write key is configured.
 *
 * Design constraints (learned the hard way against Umami 3.x):
 *   - /a/collect enforces an Origin/Referer allowlist — callers must
 *     present the portal origin (config.siteOrigin or context.origin).
 *   - Umami silently DROPS events whose User-Agent looks like a bot
 *     (200 but no row). Thread the originating browser's UA through
 *     context.userAgent whenever there is one; the fallback UA below is
 *     browser-shaped for events with no request context.
 *   - Thread context.ip through as X-Forwarded-For so the server event
 *     hashes into the same Umami session as the visitor's page views.
 *   - Tracking must NEVER break the request path: every method resolves
 *     (logging failures) and never throws.
 */

import type { IdentifyTraits, TrackContext, TrackProperties } from '../index'

export interface TrackingLogger {
  warn: (msg: string, meta?: Record<string, unknown>) => void
}

export interface ServerTrackerConfig {
  /** Absolute URL of the analytics module's ingest, e.g.
   *  `https://api.brand.com/a/collect`. Omit to disable the first-party leg. */
  collectUrl?: string
  /** The tracking property to record against. When omitted and
   *  portalConfigUrl is set, discovered lazily (and cached). */
  propertyId?: string
  /** Absolute URL of GET /a/portal-config for lazy property discovery. */
  portalConfigUrl?: string
  /** Origin presented to the ingest allowlist (the portal's public
   *  origin, e.g. `https://app.brand.com`). Overridable per event via
   *  context.origin. */
  siteOrigin?: string
  /** Segment write key — enables the Segment HTTP API leg. */
  segmentWriteKey?: string
  /** Segment HTTP API base (override for EU residency / testing). */
  segmentApiUrl?: string
  logger?: TrackingLogger
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch
}

export interface ServerTrackInput {
  properties?: TrackProperties
  userId?: string | null
  anonymousId?: string | null
  context?: TrackContext
}

export interface ServerTracker {
  track: (event: string, input?: ServerTrackInput) => Promise<void>
  identify: (userId: string, traits?: IdentifyTraits, input?: Omit<ServerTrackInput, 'userId'>) => Promise<void>
}

/** Browser-shaped UA for events with no originating request — anything
 *  bot-shaped is silently discarded by Umami's isbot filter. */
const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const noopLogger: TrackingLogger = { warn: () => undefined }

export function createServerTracker(config: ServerTrackerConfig): ServerTracker {
  const logger = config.logger ?? noopLogger
  const doFetch = config.fetchImpl ?? fetch
  const segmentApi = (config.segmentApiUrl ?? 'https://api.segment.io/v1').replace(/\/+$/, '')

  let cachedPropertyId: string | null = config.propertyId ?? null
  let propertyLookup: Promise<string | null> | null = null

  async function resolvePropertyId(): Promise<string | null> {
    if (cachedPropertyId) return cachedPropertyId
    if (!config.portalConfigUrl) return null
    // Single in-flight lookup shared across concurrent events.
    propertyLookup ??= (async () => {
      try {
        const res = await doFetch(config.portalConfigUrl!)
        if (!res.ok) return null
        const cfg = (await res.json()) as { property_id?: string }
        cachedPropertyId = cfg.property_id ?? null
        return cachedPropertyId
      } catch (e) {
        logger.warn('tracking.portal_config_failed', { error: e instanceof Error ? e.message : String(e) })
        return null
      } finally {
        propertyLookup = null
      }
    })()
    return propertyLookup
  }

  async function sendToCollect(event: string, input: ServerTrackInput): Promise<void> {
    if (!config.collectUrl) return
    const propertyId = await resolvePropertyId()
    if (!propertyId) return

    const origin = input.context?.origin ?? config.siteOrigin
    if (!origin) {
      logger.warn('tracking.collect_skipped_no_origin', { event })
      return
    }
    const hostname = (() => {
      try { return new URL(origin).hostname } catch { return origin }
    })()

    const data: Record<string, unknown> = { ...input.properties, channel: 'server' }
    if (input.userId) data.user_id = input.userId
    if (input.anonymousId) data.anonymous_id = input.anonymousId

    const payload = {
      type: 'event',
      payload: {
        website: propertyId,
        hostname,
        language: '',
        screen: '',
        title: '',
        url: input.context?.url ?? '/',
        // NOTE: never null — Umami 3.x rejects `referrer: null` with a 400.
        referrer: '',
        name: event,
        data,
      },
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Origin: origin,
      'User-Agent': input.context?.userAgent || FALLBACK_USER_AGENT,
    }
    if (input.context?.ip) headers['X-Forwarded-For'] = input.context.ip

    try {
      const res = await doFetch(config.collectUrl, { method: 'POST', headers, body: JSON.stringify(payload) })
      if (!res.ok) logger.warn('tracking.collect_failed', { event, status: res.status })
    } catch (e) {
      logger.warn('tracking.collect_threw', { event, error: e instanceof Error ? e.message : String(e) })
    }
  }

  async function sendToSegment(
    endpoint: 'track' | 'identify',
    body: Record<string, unknown>,
    input: ServerTrackInput,
  ): Promise<void> {
    if (!config.segmentWriteKey) return
    // Segment requires at least one of userId / anonymousId.
    if (!body.userId && !body.anonymousId) return

    const context: Record<string, unknown> = {}
    if (input.context?.ip) context.ip = input.context.ip
    if (input.context?.userAgent) context.userAgent = input.context.userAgent

    try {
      const res = await doFetch(`${segmentApi}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${config.segmentWriteKey}:`).toString('base64')}`,
        },
        body: JSON.stringify({ ...body, context, timestamp: new Date().toISOString() }),
      })
      if (!res.ok) logger.warn('tracking.segment_failed', { endpoint, status: res.status })
    } catch (e) {
      logger.warn('tracking.segment_threw', { endpoint, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    async track(event, input = {}) {
      await Promise.all([
        sendToCollect(event, input),
        sendToSegment('track', {
          event,
          properties: input.properties,
          userId: input.userId ?? undefined,
          anonymousId: input.anonymousId ?? undefined,
        }, input),
      ])
    },

    async identify(userId, traits, input = {}) {
      await Promise.all([
        // The first-party store has no identify endpoint — record it as a
        // regular event so anonymous→person joins are queryable there too.
        sendToCollect('identify', { ...input, userId, properties: { ...traits } }),
        sendToSegment('identify', {
          userId,
          traits,
          anonymousId: input.anonymousId ?? undefined,
        }, { ...input, userId }),
      ])
    },
  }
}
