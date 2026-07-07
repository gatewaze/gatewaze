import { describe, expect, it, vi } from 'vitest'
import { ANONYMOUS_ID_COOKIE, CONSENT_COOKIE, anonymousIdFromCookieHeader, consentFromCookieHeader, hasAnalyticsConsent } from '../index'
import { createServerTracker } from '../server/index'

const PROPERTY_ID = '11111111-2222-3333-4444-555555555555'

function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) })) as unknown as typeof fetch
}

describe('anonymousIdFromCookieHeader', () => {
  it('extracts the id among other cookies', () => {
    expect(anonymousIdFromCookieHeader(`foo=1; ${ANONYMOUS_ID_COOKIE}=abc-123; bar=2`)).toBe('abc-123')
  })

  it('decodes URI-encoded values', () => {
    expect(anonymousIdFromCookieHeader(`${ANONYMOUS_ID_COOKIE}=a%3Ab`)).toBe('a:b')
  })

  it('returns null when absent or empty', () => {
    expect(anonymousIdFromCookieHeader('foo=1')).toBeNull()
    expect(anonymousIdFromCookieHeader(null)).toBeNull()
    expect(anonymousIdFromCookieHeader(`${ANONYMOUS_ID_COOKIE}=`)).toBeNull()
  })
})

describe('createServerTracker — first-party collect leg', () => {
  it('posts the umami /api/send shape with origin, UA and XFF threading', async () => {
    const fetchImpl = okFetch()
    const tracker = createServerTracker({
      collectUrl: 'https://api.example.com/a/collect',
      propertyId: PROPERTY_ID,
      siteOrigin: 'https://app.example.com',
      fetchImpl,
    })
    await tracker.track('RSVP Submitted', {
      properties: { event_id: 'e1', party_size: 3 },
      userId: 'person-1',
      anonymousId: 'anon-1',
      context: { ip: '9.9.9.9', userAgent: 'Mozilla/5.0 real browser', url: '/e/abc' },
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.example.com/a/collect')
    const headers = init.headers as Record<string, string>
    expect(headers.Origin).toBe('https://app.example.com')
    expect(headers['User-Agent']).toBe('Mozilla/5.0 real browser')
    expect(headers['X-Forwarded-For']).toBe('9.9.9.9')
    const body = JSON.parse(init.body as string)
    expect(body.type).toBe('event')
    expect(body.payload.website).toBe(PROPERTY_ID)
    expect(body.payload.hostname).toBe('app.example.com')
    expect(body.payload.name).toBe('RSVP Submitted')
    expect(body.payload.url).toBe('/e/abc')
    // Umami 3.x 400s on referrer: null — must be a string.
    expect(body.payload.referrer).toBe('')
    expect(body.payload.data).toMatchObject({
      event_id: 'e1',
      party_size: 3,
      user_id: 'person-1',
      anonymous_id: 'anon-1',
      channel: 'server',
    })
  })

  it('falls back to a browser-shaped UA when no request context exists', async () => {
    const fetchImpl = okFetch()
    const tracker = createServerTracker({
      collectUrl: 'https://api.example.com/a/collect',
      propertyId: PROPERTY_ID,
      siteOrigin: 'https://app.example.com',
      fetchImpl,
    })
    await tracker.track('Job Completed')
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^Mozilla\/5\.0/)
  })

  it('discovers the property from portal-config once and caches it', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('portal-config')) {
        return { ok: true, status: 200, json: async () => ({ property_id: PROPERTY_ID }) }
      }
      return { ok: true, status: 204, json: async () => ({}) }
    }) as unknown as typeof fetch
    const tracker = createServerTracker({
      collectUrl: 'https://api.example.com/a/collect',
      portalConfigUrl: 'https://api.example.com/a/portal-config',
      siteOrigin: 'https://app.example.com',
      fetchImpl,
    })
    await tracker.track('One')
    await tracker.track('Two')
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(calls.filter((u) => u.includes('portal-config'))).toHaveLength(1)
    expect(calls.filter((u) => u.includes('/a/collect'))).toHaveLength(2)
  })

  it('skips the leg without an origin and never throws on network failure', async () => {
    const logger = { warn: vi.fn() }
    const noOrigin = createServerTracker({
      collectUrl: 'https://api.example.com/a/collect',
      propertyId: PROPERTY_ID,
      fetchImpl: okFetch(),
      logger,
    })
    await noOrigin.track('X')
    expect(logger.warn).toHaveBeenCalledWith('tracking.collect_skipped_no_origin', expect.anything())

    const failing = createServerTracker({
      collectUrl: 'https://api.example.com/a/collect',
      propertyId: PROPERTY_ID,
      siteOrigin: 'https://app.example.com',
      fetchImpl: vi.fn(async () => { throw new Error('down') }) as unknown as typeof fetch,
      logger,
    })
    await expect(failing.track('X')).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('tracking.collect_threw', expect.anything())
  })
})

describe('createServerTracker — segment leg', () => {
  it('posts track with basic-auth write key, ids and context', async () => {
    const fetchImpl = okFetch()
    const tracker = createServerTracker({
      segmentWriteKey: 'wk123',
      fetchImpl,
    })
    await tracker.track('Signed In', {
      userId: 'u1',
      anonymousId: 'a1',
      properties: { method: 'lfid' },
      context: { ip: '1.2.3.4', userAgent: 'UA' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.segment.io/v1/track')
    expect((init.headers as Record<string, string>).Authorization)
      .toBe(`Basic ${Buffer.from('wk123:').toString('base64')}`)
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      event: 'Signed In',
      userId: 'u1',
      anonymousId: 'a1',
      properties: { method: 'lfid' },
      context: { ip: '1.2.3.4', userAgent: 'UA' },
    })
    expect(body.timestamp).toBeTruthy()
  })

  it('skips segment without any id, and entirely without a write key', async () => {
    const fetchImpl = okFetch()
    const noIds = createServerTracker({ segmentWriteKey: 'wk123', fetchImpl })
    await noIds.track('Anonymous-less event')
    expect(fetchImpl).not.toHaveBeenCalled()

    const noKey = createServerTracker({ fetchImpl })
    await noKey.track('X', { userId: 'u1' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('identify hits /identify and mirrors into the first-party store as an event', async () => {
    const fetchImpl = okFetch()
    const tracker = createServerTracker({
      collectUrl: 'https://api.example.com/a/collect',
      propertyId: PROPERTY_ID,
      siteOrigin: 'https://app.example.com',
      segmentWriteKey: 'wk123',
      fetchImpl,
    })
    await tracker.identify('u1', { email: 'x@example.com' }, { anonymousId: 'a1' })
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls
    const urls = calls.map((c) => String(c[0]))
    expect(urls).toContain('https://api.segment.io/v1/identify')
    expect(urls).toContain('https://api.example.com/a/collect')
    const collectBody = JSON.parse(calls[urls.indexOf('https://api.example.com/a/collect')][1].body as string)
    expect(collectBody.payload.name).toBe('identify')
    expect(collectBody.payload.data).toMatchObject({ user_id: 'u1', anonymous_id: 'a1', email: 'x@example.com' })
  })
})

describe('consent parsing', () => {
  it('null (implicit consent) when no cookie', () => {
    expect(consentFromCookieHeader('foo=1')).toBeNull()
    expect(hasAnalyticsConsent('foo=1')).toBe(true)
    expect(hasAnalyticsConsent(null)).toBe(true)
  })

  it('explicit denial blocks', () => {
    const value = encodeURIComponent(JSON.stringify({ analytics: false, marketing: false, functional: true }))
    const header = `${CONSENT_COOKIE}=${value}; other=1`
    expect(consentFromCookieHeader(header)).toEqual({ analytics: false, marketing: false, functional: true })
    expect(hasAnalyticsConsent(header)).toBe(false)
  })

  it('explicit grant allows; malformed cookie falls back to implicit', () => {
    const granted = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify({ analytics: true }))}`
    expect(hasAnalyticsConsent(granted)).toBe(true)
    expect(hasAnalyticsConsent(`${CONSENT_COOKIE}=not-json`)).toBe(true)
  })
})

describe('createServerTracker — page()', () => {
  it('sends a name-less umami payload (pageview) with client context, and Segment /page', async () => {
    const fetchImpl = okFetch()
    const tracker = createServerTracker({
      collectUrl: 'https://api.example.com/a/collect',
      propertyId: PROPERTY_ID,
      siteOrigin: 'https://app.example.com',
      segmentWriteKey: 'wk123',
      fetchImpl,
    })
    await tracker.page('Events', {
      anonymousId: 'a1',
      client: { path: '/events', url: 'https://app.example.com/events', title: 'Events', screen: '1280x720', language: 'en-US', referrer: 'https://app.example.com/' },
    })
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls
    const urls = calls.map((c) => String(c[0]))
    const collectBody = JSON.parse(calls[urls.indexOf('https://api.example.com/a/collect')][1].body as string)
    // No `name` → Umami records a pageview, not a custom event.
    expect(collectBody.payload.name).toBeUndefined()
    expect(collectBody.payload.url).toBe('/events')
    expect(collectBody.payload.screen).toBe('1280x720')
    expect(collectBody.payload.language).toBe('en-US')
    expect(collectBody.payload.title).toBe('Events')
    expect(collectBody.payload.referrer).toBe('https://app.example.com/')
    expect(urls).toContain('https://api.segment.io/v1/page')
    const pageBody = JSON.parse(calls[urls.indexOf('https://api.segment.io/v1/page')][1].body as string)
    expect(pageBody.name).toBe('Events')
    expect(pageBody.anonymousId).toBe('a1')
    expect(pageBody.properties.path).toBe('/events')
  })
})
