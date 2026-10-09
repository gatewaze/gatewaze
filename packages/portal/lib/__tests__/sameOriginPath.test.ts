import { afterEach, describe, expect, it, vi } from 'vitest'
import { portalOrigins, sameOriginPath } from '../sameOriginPath'

const APP = 'https://community.example'

describe('sameOriginPath', () => {
  it('keeps ordinary same-origin paths, including query and hash', () => {
    expect(sameOriginPath('/')).toBe('/')
    expect(sameOriginPath('/events')).toBe('/events')
    expect(sameOriginPath('/events/123?tab=speakers#top')).toBe('/events/123?tab=speakers#top')
    expect(sameOriginPath('/a%20b/%0a')).toBe('/a%20b/%0a')
  })

  it('falls back to / for empty values', () => {
    expect(sameOriginPath(null)).toBe('/')
    expect(sameOriginPath(undefined)).toBe('/')
    expect(sameOriginPath('')).toBe('/')
  })

  it('reduces an absolute URL on an allowed origin to its path, query and hash', () => {
    expect(sameOriginPath(`${APP}/calendars/kubecon?joined=1`, [APP])).toBe('/calendars/kubecon?joined=1')
    expect(sameOriginPath(`${APP}/events#top`, ['https://other.example', APP])).toBe('/events#top')
    expect(sameOriginPath(`${APP}`, [APP])).toBe('/')
    expect(sameOriginPath('HTTPS://community.example/x', [APP])).toBe('/x')
  })

  it('falls back to / for an http(s) value that does not parse', () => {
    expect(sameOriginPath('https://[', [APP])).toBe('/')
    expect(sameOriginPath('http://', [APP])).toBe('/')
  })

  it('rejects absolute URLs on any other origin, including near misses', () => {
    expect(sameOriginPath('https://evil.example/', [APP])).toBe('/')
    expect(sameOriginPath(`${APP}.evil.example/`, [APP])).toBe('/')
    expect(sameOriginPath(`${APP}@evil.example/`, [APP])).toBe('/')
    expect(sameOriginPath('http://community.example/', [APP])).toBe('/')
    expect(sameOriginPath(`${APP}:8443/`, [APP])).toBe('/')
    expect(sameOriginPath(`${APP}/events`)).toBe('/')
  })

  it('rejects non-http schemes and bare words', () => {
    expect(sameOriginPath('javascript:alert(1)', [APP])).toBe('/')
    expect(sameOriginPath('data:text/html,hi', [APP])).toBe('/')
    expect(sameOriginPath('events')).toBe('/')
  })

  it('rejects protocol-relative and slash-collapsing forms', () => {
    expect(sameOriginPath('//evil.example')).toBe('/')
    expect(sameOriginPath('///evil.example')).toBe('/')
    expect(sameOriginPath('/\\evil.example')).toBe('/')
    expect(sameOriginPath('/\\/evil.example')).toBe('/')
    expect(sameOriginPath('/events\\..\\evil')).toBe('/')
  })

  it('rejects dot segments that resolve to a //-prefixed path', () => {
    expect(sameOriginPath('/.//evil.example')).toBe('/')
    expect(sameOriginPath('/..//evil.example')).toBe('/')
    expect(sameOriginPath('/events/..//evil.example')).toBe('/')
    expect(sameOriginPath(`${APP}/.//evil.example`, [APP])).toBe('/')
  })

  it('resolves harmless dot segments to the normalised path', () => {
    expect(sameOriginPath('/events/./123/../456')).toBe('/events/456')
  })

  it('rejects control characters that browsers strip before parsing', () => {
    expect(sameOriginPath('/\t//evil.example')).toBe('/')
    expect(sameOriginPath('/\n//evil.example')).toBe('/')
    expect(sameOriginPath('/\r//evil.example')).toBe('/')
    expect(sameOriginPath('/events\u0000')).toBe('/')
    expect(sameOriginPath('/events\u007f')).toBe('/')
  })
})

describe('portalOrigins', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('includes the request origin, the window origin and the configured app URL origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', `${APP}/`)
    const origins = portalOrigins('https://request.example')
    expect(origins).toContain('https://request.example')
    expect(origins).toContain(window.location.origin)
    expect(origins).toContain(APP)
  })

  it('ignores a malformed app URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'not a url')
    expect(portalOrigins()).toEqual([window.location.origin])
  })
})
