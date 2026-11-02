import { describe, it, expect } from 'vitest'
import { parseShortLinkHosts, resolveShortLinkPath, SHORT_LINK_SLUG_RE } from '../short-link-hosts'

describe('parseShortLinkHosts', () => {
  it('parses host and host=home entries', () => {
    const hosts = parseShortLinkHosts(' go.mlops.community=https://mlops.community , Links.Example.com ')
    expect(hosts.get('go.mlops.community')).toEqual({ host: 'go.mlops.community', homeUrl: 'https://mlops.community/' })
    expect(hosts.get('links.example.com')).toEqual({ host: 'links.example.com', homeUrl: null })
  })

  it('returns an empty map when unset', () => {
    expect(parseShortLinkHosts(undefined).size).toBe(0)
    expect(parseShortLinkHosts('').size).toBe(0)
  })

  it('drops invalid hosts and non-http home URLs', () => {
    const hosts = parseShortLinkHosts('bad host,evil.example=javascript:alert(1),ok.example=not a url')
    expect(hosts.has('bad host')).toBe(false)
    expect(hosts.get('evil.example')?.homeUrl).toBeNull()
    expect(hosts.get('ok.example')?.homeUrl).toBeNull()
  })
})

describe('resolveShortLinkPath', () => {
  const withHome = { host: 'go.mlops.community', homeUrl: 'https://mlops.community/' }
  const noHome = { host: 'links.example.com', homeUrl: null }

  it('sends the root to the home URL, or 404s without one', () => {
    expect(resolveShortLinkPath(withHome, '/')).toEqual({ kind: 'home', url: 'https://mlops.community/' })
    expect(resolveShortLinkPath(noHome, '/')).toEqual({ kind: 'not-found' })
  })

  it('rewrites a single-segment slug to /go/<slug>, keeping its encoding', () => {
    expect(resolveShortLinkPath(withHome, '/NL_Jobs_Board')).toEqual({ kind: 'rewrite', pathname: '/go/NL_Jobs_Board' })
    expect(resolveShortLinkPath(withHome, '/l&lsession25')).toEqual({ kind: 'rewrite', pathname: '/go/l&lsession25' })
    expect(resolveShortLinkPath(withHome, '/the_%5Bai%5D_office')).toEqual({ kind: 'rewrite', pathname: '/go/the_%5Bai%5D_office' })
    expect(resolveShortLinkPath(withHome, '/abc/')).toEqual({ kind: 'rewrite', pathname: '/go/abc' })
  })

  it('404s on multi-segment, malformed, or out-of-charset paths', () => {
    expect(resolveShortLinkPath(withHome, '/calendar/google')).toEqual({ kind: 'not-found' })
    expect(resolveShortLinkPath(withHome, '/%E0%A4%A')).toEqual({ kind: 'not-found' })
    expect(resolveShortLinkPath(withHome, '/a%2Fb')).toEqual({ kind: 'not-found' })
    expect(resolveShortLinkPath(withHome, '/has%20space')).toEqual({ kind: 'not-found' })
    expect(resolveShortLinkPath(withHome, '/' + 'x'.repeat(81))).toEqual({ kind: 'not-found' })
  })
})

describe('SHORT_LINK_SLUG_RE', () => {
  it('accepts the Short.io-era characters and rejects separators', () => {
    for (const ok of ['abc', 'l&l_20_asset', '+ubergem1', 'apply()link', 'the_[ai]_office', 'a.b~c-d']) {
      expect(SHORT_LINK_SLUG_RE.test(ok)).toBe(true)
    }
    for (const bad of ['', 'a/b', 'a b', 'a?b', 'a#b', 'a%b', 'a|b']) {
      expect(SHORT_LINK_SLUG_RE.test(bad)).toBe(false)
    }
  })
})
