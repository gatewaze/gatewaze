import { describe, it, expect } from 'vitest'
import { isOwnEndpoint, navChildrenFrom } from '@/lib/nav-children'

const HREF = '/events/dan-sarah/photos'

describe('the children a page lists beneath it', () => {
  it('takes a label and a path and builds an address under the page', () => {
    const kids = navChildrenFrom({ nav: [{ label: 'Getting ready', path: 'getting-ready', count: 37 }] }, HREF)
    expect(kids).toEqual([{ label: 'Getting ready', href: `${HREF}/getting-ready`, count: 37 }])
  })

  // The answer is not this portal's data, so a path may only ever go
  // deeper into the page that declared it.
  it('refuses a path that climbs out of the page', () => {
    for (const path of ['../../admin', '..', './../x', 'a/../../b', '']) {
      expect(navChildrenFrom({ nav: [{ label: 'x', path }] }, HREF)).toEqual([])
    }
  })

  it('cannot produce another scheme or another host', () => {
    for (const path of ['javascript:alert(1)', '//evil.example/x', 'https://evil.example']) {
      const [kid] = navChildrenFrom({ nav: [{ label: 'x', path }] }, HREF)
      // Either refused outright (the empty segments in //host), or landed
      // under this page's own address with the colon encoded. Never a
      // scheme, and never another host.
      if (!kid) continue
      expect(kid.href.startsWith(`${HREF}/`)).toBe(true)
      expect(kid.href).not.toContain('//evil.example')
      expect(kid.href).not.toMatch(/^[a-z]+:/i)
    }
  })

  it('ignores anything that is not a label and a path', () => {
    const kids = navChildrenFrom({ nav: [
      { label: 42, path: 'x' },
      { label: 'x' },
      { path: 'x' },
      { label: '   ', path: 'x' },
      null,
    ] }, HREF)
    expect(kids).toEqual([])
  })

  it('is not a list of a thousand things', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ label: `a${i}`, path: `a${i}` }))
    expect(navChildrenFrom({ nav: many }, HREF)).toHaveLength(12)
  })

  it('says nothing about a body that is not one', () => {
    for (const body of [null, undefined, {}, { nav: 'lots' }, 'no']) {
      expect(navChildrenFrom(body, HREF)).toEqual([])
    }
  })

  it('keeps a count only when it is one', () => {
    expect(navChildrenFrom({ nav: [{ label: 'a', path: 'a', count: 'many' }] }, HREF)[0]?.count).toBeUndefined()
    expect(navChildrenFrom({ nav: [{ label: 'a', path: 'a', count: Infinity }] }, HREF)[0]?.count).toBeUndefined()
  })
})

describe('which endpoints the portal will ask', () => {
  it('asks its own, and nobody else’s', () => {
    expect(isOwnEndpoint('/api/public/event-media/events/x/gallery')).toBe(true)
    for (const bad of ['https://evil.example/x', '//evil.example/x', 'api/x', '', '/']) {
      expect(isOwnEndpoint(bad)).toBe(false)
    }
  })
})
