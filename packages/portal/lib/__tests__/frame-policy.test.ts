import { describe, it, expect } from 'vitest'
import { frameAncestors, isEmbedPath, parseFrameOrigins } from '../frame-policy'

describe('parseFrameOrigins', () => {
  it('keeps https origins, lower-cased, without trailing slashes or duplicates', () => {
    expect(parseFrameOrigins(' https://aaif.io/, https://WWW.aaif.io ,https://aaif.io')).toEqual(['https://aaif.io', 'https://www.aaif.io'])
  })

  it('allows a leading wildcard label and a port', () => {
    expect(parseFrameOrigins('https://*.aaif.workers.dev,https://preview.example.com:8443')).toEqual([
      'https://*.aaif.workers.dev',
      'https://preview.example.com:8443',
    ])
  })

  it.each([
    '*', 'http://aaif.io', 'https://*', 'https://*.com', 'aaif.io', "https://aaif.io 'unsafe-inline'",
    'https://aaif.io/path', 'https://a.*.io', 'https://aaif.io;script-src *', 'javascript:alert(1)',
  ])('drops %j so a typo can never widen the policy', (v) => {
    expect(parseFrameOrigins(v)).toEqual([])
  })

  it('is empty for nothing', () => {
    expect(parseFrameOrigins(undefined)).toEqual([])
    expect(parseFrameOrigins('')).toEqual([])
  })
})

describe('frameAncestors', () => {
  const env = { EMBED_FRAME_ANCESTORS: 'https://aaif.io', PORTAL_FRAME_ANCESTORS: '' }

  it('lets the embedding sites frame embed pages', () => {
    expect(frameAncestors('/embed/slack', env)).toBe("frame-ancestors 'self' https://aaif.io")
    expect(frameAncestors('/embed-auth', env)).toBe("frame-ancestors 'self' https://aaif.io")
  })

  it('lets nobody else frame any other page', () => {
    for (const p of ['/', '/slack', '/embedded', '/embedx/slack', '/sign-in', '/api/public/x']) {
      expect(frameAncestors(p, env)).toBe("frame-ancestors 'self'")
    }
  })

  it('honours PORTAL_FRAME_ANCESTORS for ordinary pages only', () => {
    const e = { PORTAL_FRAME_ANCESTORS: 'https://partner.example.org' }
    expect(frameAncestors('/events', e)).toBe("frame-ancestors 'self' https://partner.example.org")
    expect(frameAncestors('/embed/slack', e)).toBe("frame-ancestors 'self'")
  })
})

describe('isEmbedPath', () => {
  it.each([['/embed/slack', true], ['/embed', true], ['/embed-auth', true], ['/embedx', false], ['/m/embed', false]])('%s → %s', (p, want) => {
    expect(isEmbedPath(p)).toBe(want)
  })
})
