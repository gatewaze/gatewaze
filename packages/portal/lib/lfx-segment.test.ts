import { describe, expect, it } from 'vitest'
import {
  auth0ClaimsForUser,
  cleanSearch,
  cleanUrl,
  forwardableTrack,
  isAllowedWrapperUrl,
  LF_CDP_UUID_CLAIM,
  LF_USERNAME_CLAIM,
  lfxSegmentConfig,
  relaySegmentWriteKey,
  sanitizeSegmentEvent,
} from './lfx-segment'

const UUID = '9f1c2e7a-4b55-4c9a-8f0d-1e2a3b4c5d6e'
const WRAPPER = 'https://lfx-segment.platform.linuxfoundation.org/latest/lfx-segment-analytics.min.js?ver=1.0.1'

describe('auth0ClaimsForUser (what identifyAuth0User receives)', () => {
  it('maps a full LFID session user to the claim names the LF wrapper reads', () => {
    expect(
      auth0ClaimsForUser({
        email: 'ada@example.org',
        user_metadata: {
          full_name: 'Ada Lovelace',
          given_name: 'Ada',
          family_name: 'Lovelace',
          avatar_url: 'https://cdn.example.org/a.png',
          lfid_username: 'ada',
          lfid_sub: 'auth0|ada',
        },
        app_metadata: { provider: 'lfid', cdp_uuid: UUID },
      }),
    ).toEqual({
      email: 'ada@example.org',
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
      picture: 'https://cdn.example.org/a.png',
      [LF_USERNAME_CLAIM]: 'ada',
      [LF_CDP_UUID_CLAIM]: UUID,
    })
  })

  it('never sends lfid_sub (auth0|...) anywhere the wrapper could use it as an id', () => {
    const claims = auth0ClaimsForUser({
      email: 'ada@example.org',
      user_metadata: { lfid_sub: 'auth0|ada' },
    })
    expect(JSON.stringify(claims)).not.toContain('auth0|')
  })

  it('sends the LF username only for LFID sign-ins (user_metadata is user-writable)', () => {
    const claims = auth0ClaimsForUser({
      email: 'otp@example.org',
      user_metadata: { lfid_username: 'someone-else' },
      app_metadata: { provider: 'email' },
    })
    expect(claims).not.toHaveProperty(LF_USERNAME_CLAIM)
  })

  it('reads the CDP UUID from app_metadata only, never user_metadata', () => {
    const claims = auth0ClaimsForUser({
      email: 'mallory@example.org',
      user_metadata: { cdp_uuid: UUID },
      app_metadata: {},
    })
    expect(claims).not.toHaveProperty(LF_CDP_UUID_CLAIM)
  })

  it('falls back to first_name / last_name / name', () => {
    expect(
      auth0ClaimsForUser({ email: 'b@example.org', user_metadata: { name: 'B C', first_name: 'B', last_name: 'C' } }),
    ).toEqual({ email: 'b@example.org', name: 'B C', given_name: 'B', family_name: 'C' })
  })

  it('returns null without an email (the wrapper will not identify)', () => {
    expect(auth0ClaimsForUser({ email: '', user_metadata: { lfid_username: 'x' } })).toBeNull()
    expect(auth0ClaimsForUser({ email: null })).toBeNull()
    expect(auth0ClaimsForUser({ email: '  ' })).toBeNull()
  })
})

describe('cleanUrl / cleanSearch (URL secrets stay out of Segment)', () => {
  it('drops the hash, which carries the sign-in session on LFID return', () => {
    expect(cleanUrl('https://aaif.live/auth/callback#access_token=abc&refresh_token=def')).toBe(
      'https://aaif.live/auth/callback',
    )
  })

  it('keeps utm_* and drops every other query param', () => {
    expect(cleanUrl('https://aaif.live/e/x?token=secret&utm_source=news&code=1&UTM_Medium=email')).toBe(
      'https://aaif.live/e/x?utm_source=news&UTM_Medium=email',
    )
  })

  it('keeps relative paths relative', () => {
    expect(cleanUrl('/events/abc?t=secret&utm_campaign=c')).toBe('/events/abc?utm_campaign=c')
  })

  it('treats protocol-relative URLs as absolute', () => {
    expect(cleanUrl('//evil.example/x?t=1')).toBe('https://evil.example/x')
  })

  it('fails closed on an unparsable URL (never passes the raw value through)', () => {
    expect(cleanUrl('https://a b.com/?token=secret')).toBe('')
    expect(cleanUrl('http://')).toBe('')
  })

  it('masks invite / RSVP codes carried in the path', () => {
    expect(cleanUrl('https://aaif.live/event-invites/SECRET1?utm_source=x')).toBe('https://aaif.live/event-invites/:token?utm_source=x')
    expect(cleanUrl('/rsvp/SECRET2')).toBe('/rsvp/:token')
    expect(cleanUrl('/invite/SECRET3/extra')).toBe('/invite/:token/extra')
    expect(cleanUrl('/I/SECRET4')).toBe('/I/:token')
    expect(cleanUrl('/events/my-event')).toBe('/events/my-event')
    expect(cleanUrl('/rsvp')).toBe('/rsvp')
  })

  it('leaves non-strings and empty strings alone', () => {
    expect(cleanUrl(undefined)).toBeUndefined()
    expect(cleanUrl('')).toBe('')
    expect(cleanUrl(5)).toBe(5)
  })

  it('cleans a bare query string with or without the ?', () => {
    expect(cleanSearch('?a=1&utm_source=x')).toBe('?utm_source=x')
    expect(cleanSearch('a=1')).toBe('')
  })
})

describe('sanitizeSegmentEvent', () => {
  it('cleans properties and context.page, and leaves type and messageId alone', () => {
    const event = sanitizeSegmentEvent({
      type: 'page',
      messageId: 'm-1',
      properties: { url: 'https://aaif.live/x?t=1#h', path: '/x?t=1', search: '?t=1', referrer: 'https://a.b/?q=1', domain: 'aaif.live' },
      context: { page: { url: 'https://aaif.live/x?utm_source=s&t=1', search: '?utm_source=s&t=1', referrer: '' } },
    })
    expect(event).toEqual({
      type: 'page',
      messageId: 'm-1',
      properties: { url: 'https://aaif.live/x', path: '/x', search: '', referrer: 'https://a.b/', domain: 'aaif.live' },
      context: { page: { url: 'https://aaif.live/x?utm_source=s', search: '?utm_source=s', referrer: '' } },
    })
  })

  it('cleans href on track properties (Link Clicked)', () => {
    expect(
      sanitizeSegmentEvent({ type: 'track', messageId: 'm', properties: { href: '/i/abc?token=t' } }).properties,
    ).toEqual({ href: '/i/:token' })
  })
})

describe('forwardableTrack (portal SDK events → wrapper track)', () => {
  it('forwards a custom event with cleaned properties', () => {
    expect(forwardableTrack({ event: 'Link Clicked', properties: { href: '/x?t=1', outbound: false } })).toEqual({
      event: 'Link Clicked',
      properties: { href: '/x', outbound: false },
    })
  })

  it('does not mutate the caller’s properties object', () => {
    const properties = { href: '/x?t=1' }
    forwardableTrack({ event: 'Link Clicked', properties })
    expect(properties.href).toBe('/x?t=1')
  })

  it('skips page_view and identify, which the wrapper sends itself', () => {
    expect(forwardableTrack({ event: 'page_view' })).toBeNull()
    expect(forwardableTrack({ event: 'identify', properties: { user_id: 'x' } })).toBeNull()
  })

  it('rejects malformed details', () => {
    expect(forwardableTrack(null)).toBeNull()
    expect(forwardableTrack({ event: '' })).toBeNull()
    expect(forwardableTrack({ event: 'x'.repeat(121) })).toBeNull()
    expect(forwardableTrack({ event: 'x'.repeat(120) })).toEqual({ event: 'x'.repeat(120), properties: undefined })
    expect(forwardableTrack({ event: 5 })).toBeNull()
    expect(forwardableTrack({ event: 'X', properties: [1, 2] })).toEqual({ event: 'X', properties: undefined })
  })
})

describe('isAllowedWrapperUrl / lfxSegmentConfig', () => {
  it('accepts only https on the LF wrapper host', () => {
    expect(isAllowedWrapperUrl(WRAPPER)).toBe(true)
    expect(isAllowedWrapperUrl('http://lfx-segment.platform.linuxfoundation.org/x.js')).toBe(false)
    expect(isAllowedWrapperUrl('https://lfx-segment.platform.linuxfoundation.org.evil.example/x.js')).toBe(false)
    expect(isAllowedWrapperUrl('https://evil.example/lfx-segment.platform.linuxfoundation.org.js')).toBe(false)
    expect(isAllowedWrapperUrl('not a url')).toBe(false)
    expect(isAllowedWrapperUrl(undefined)).toBe(false)
  })

  it('is off unless a valid wrapper URL is configured', () => {
    expect(lfxSegmentConfig({})).toBeNull()
    expect(lfxSegmentConfig({ LFX_SEGMENT_CDN_URL: '' })).toBeNull()
    expect(lfxSegmentConfig({ LFX_SEGMENT_CDN_URL: 'https://evil.example/x.js' })).toBeNull()
  })

  it('returns the URL, plus the write key only when one is set', () => {
    expect(lfxSegmentConfig({ LFX_SEGMENT_CDN_URL: ` ${WRAPPER} ` })).toEqual({ src: WRAPPER })
    expect(lfxSegmentConfig({ LFX_SEGMENT_CDN_URL: WRAPPER, LFX_SEGMENT_WRITE_KEY: 'wk' })).toEqual({
      src: WRAPPER,
      writeKey: 'wk',
    })
    expect(lfxSegmentConfig({ LFX_SEGMENT_CDN_URL: WRAPPER, LFX_SEGMENT_WRITE_KEY: '  ' })).toEqual({ src: WRAPPER })
  })
})

describe('relaySegmentWriteKey (server relay Segment leg)', () => {
  it('uses SEGMENT_WRITE_KEY when the LF wrapper is not configured', () => {
    expect(relaySegmentWriteKey({ SEGMENT_WRITE_KEY: 'server-wk' })).toBe('server-wk')
  })

  it('is off when the LF wrapper sends from the browser', () => {
    expect(relaySegmentWriteKey({ SEGMENT_WRITE_KEY: 'server-wk', LFX_SEGMENT_CDN_URL: WRAPPER })).toBeUndefined()
  })

  it('stays on when the wrapper URL is not an LF URL (the browser loads nothing)', () => {
    expect(relaySegmentWriteKey({ SEGMENT_WRITE_KEY: 'server-wk', LFX_SEGMENT_CDN_URL: 'https://evil.example/x.js' })).toBe('server-wk')
  })

  it('is off when neither is set', () => {
    expect(relaySegmentWriteKey({})).toBeUndefined()
  })
})
