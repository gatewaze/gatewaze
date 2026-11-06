import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { user: null as Record<string, unknown> | null, isLoading: false }
const consent = { categories: { analytics: true } }
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useConsent', () => ({ useConsent: () => consent }))

const SRC = 'https://lfx-segment.platform.linuxfoundation.org/latest/lfx-segment-analytics.min.js'
const UUID = '9f1c2e7a-4b55-4c9a-8f0d-1e2a3b4c5d6e'

type Wrapper = Record<string, ReturnType<typeof vi.fn>>
let appended: HTMLScriptElement[] = []

function fakeWrapper(overrides: Partial<Wrapper> = {}): Wrapper {
  return {
    initWithEventSanitizer: vi.fn().mockResolvedValue(undefined),
    identifyAuth0User: vi.fn(),
    page: vi.fn(),
    track: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

/** Installs `instance` as the wrapper the script exposes and fires onload. */
async function loadScript(instance: Record<string, unknown> | undefined) {
  ;(window as unknown as { LfxAnalytics?: unknown }).LfxAnalytics = instance
    ? { LfxSegmentsAnalytics: { getInstance: () => instance } }
    : undefined
  await act(async () => {
    for (const s of appended) await (s.onload as () => Promise<void>)?.()
  })
}

async function mount() {
  // Fresh module per test: the loader promise is a module-level singleton.
  const { LfxSegment } = await import('./LfxSegment')
  return render(<LfxSegment src={SRC} />)
}

const lfidUser = {
  id: 'u1',
  email: 'ada@example.org',
  user_metadata: { full_name: 'Ada Lovelace', lfid_username: 'ada', lfid_sub: 'auth0|ada' },
  app_metadata: { provider: 'lfid', cdp_uuid: UUID },
}

beforeEach(() => {
  vi.resetModules()
  appended = []
  auth.user = null
  auth.isLoading = false
  consent.categories = { analytics: true }
  const real = document.head.appendChild.bind(document.head)
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) {
      appended.push(node)
      return node
    }
    return real(node)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as unknown as { LfxAnalytics?: unknown }).LfxAnalytics
})

describe('LfxSegment', () => {
  it('loads the LF script in protected mode and identifies with the CDP UUID claim', async () => {
    auth.user = lfidUser
    const w = fakeWrapper()
    await mount()
    expect(appended.map((s) => s.src)).toEqual([SRC])
    await loadScript(w)
    expect(w.initWithEventSanitizer).toHaveBeenCalledTimes(1)
    expect(w.identifyAuth0User).toHaveBeenCalledTimes(1)
    const claims = w.identifyAuth0User.mock.calls[0][0]
    expect(claims['http://lfx.dev/claims/uuid']).toBe(UUID)
    expect(claims.email).toBe('ada@example.org')
    expect(JSON.stringify(claims)).not.toContain('auth0|')
  })

  it('loads nothing and identifies no one without analytics consent', async () => {
    auth.user = lfidUser
    consent.categories = { analytics: false }
    await mount()
    expect(appended).toHaveLength(0)
  })

  it('does not reload when consent was never given', async () => {
    consent.categories = { analytics: false }
    const view = await mount()
    const { LfxSegment, pageControl } = await import('./LfxSegment')
    const reload = vi.spyOn(pageControl, 'reload').mockImplementation(() => undefined)
    await act(async () => {
      view.rerender(<LfxSegment src={SRC} />)
    })
    expect(reload).not.toHaveBeenCalled()
  })

  it('fails closed when the wrapper has no protected initialization', async () => {
    auth.user = lfidUser
    const w = fakeWrapper()
    delete (w as Partial<Wrapper>).initWithEventSanitizer
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mount()
    await loadScript(w)
    await act(async () => {
      document.dispatchEvent(new CustomEvent('analytics', { detail: { event: 'Link Clicked' } }))
    })
    expect(w.identifyAuth0User).not.toHaveBeenCalled()
    expect(w.track).not.toHaveBeenCalled()
  })

  it('fails closed when protected initialization rejects', async () => {
    auth.user = lfidUser
    const w = fakeWrapper({ initWithEventSanitizer: vi.fn().mockRejectedValue(new Error('boom')) })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mount()
    await loadScript(w)
    await act(async () => {
      document.dispatchEvent(new CustomEvent('analytics', { detail: { event: 'Link Clicked' } }))
    })
    expect(w.identifyAuth0User).not.toHaveBeenCalled()
    expect(w.track).not.toHaveBeenCalled()
  })

  it('forwards portal custom events as track calls, but not page_view / identify', async () => {
    const w = fakeWrapper()
    await mount()
    await loadScript(w)
    await act(async () => {
      document.dispatchEvent(new CustomEvent('analytics', { detail: { event: 'Link Clicked', properties: { href: '/x?t=1' } } }))
      document.dispatchEvent(new CustomEvent('analytics', { detail: { event: 'page_view' } }))
      document.dispatchEvent(new CustomEvent('analytics', { detail: { event: 'identify' } }))
    })
    expect(w.track).toHaveBeenCalledTimes(1)
    expect(w.track).toHaveBeenCalledWith('Link Clicked', { href: '/x' })
  })

  it('does not send its own first page view (the wrapper sends it on start)', async () => {
    const w = fakeWrapper()
    await mount()
    await loadScript(w)
    expect(w.page).not.toHaveBeenCalled()
  })

  it('resets once on sign-out after an identify, and not on a signed-out load', async () => {
    auth.user = lfidUser
    const w = fakeWrapper()
    const view = await mount()
    await loadScript(w)
    expect(w.reset).not.toHaveBeenCalled()
    const { LfxSegment } = await import('./LfxSegment')
    auth.user = null
    await act(async () => {
      view.rerender(<LfxSegment src={SRC} />)
    })
    expect(w.reset).toHaveBeenCalledTimes(1)
  })

  it('identifies a user once, not on every render', async () => {
    auth.user = lfidUser
    const w = fakeWrapper()
    const view = await mount()
    await loadScript(w)
    const { LfxSegment } = await import('./LfxSegment')
    auth.user = { ...lfidUser }
    await act(async () => {
      view.rerender(<LfxSegment src={SRC} />)
    })
    expect(w.identifyAuth0User).toHaveBeenCalledTimes(1)
  })

  it('resets, reloads and stops tracking when consent is withdrawn after loading', async () => {
    auth.user = lfidUser
    const w = fakeWrapper()
    const view = await mount()
    await loadScript(w)
    const { LfxSegment, pageControl } = await import('./LfxSegment')
    const reload = vi.spyOn(pageControl, 'reload').mockImplementation(() => undefined)
    consent.categories = { analytics: false }
    await act(async () => {
      view.rerender(<LfxSegment src={SRC} />)
    })
    expect(w.reset).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(w.reset.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0])
    await act(async () => {
      document.dispatchEvent(new CustomEvent('analytics', { detail: { event: 'Link Clicked' } }))
    })
    expect(w.track).not.toHaveBeenCalled()
  })
})
