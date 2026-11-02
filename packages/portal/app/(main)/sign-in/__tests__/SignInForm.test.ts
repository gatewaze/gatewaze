import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render, waitFor } from '@testing-library/react'
import type { BrandConfig } from '@/config/brand'

// These tests pin the navigation sinks themselves: that the component routes
// every destination through sameOriginPath, and that a PKCE return (?code=)
// takes the full-navigation path while an already-signed-in visitor keeps the
// soft push. The helper's own rules are covered in lib/__tests__.

const push = vi.fn()
const replace = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/sign-in',
  useSearchParams: () => searchParams,
  useParams: () => ({}),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isLoading: false, signInWithMagicLink: vi.fn() }),
}))

vi.mock('@/lib/modules', () => ({
  hasPortalSlot: () => false,
  ModuleSlot: () => null,
}))

// The real module imports @gatewaze/shared, which the portal's vitest cannot
// resolve, so the two exports the render tree uses are stubbed explicitly.
vi.mock('@/config/brand', () => ({
  getClientBrandConfig: () => ({ primaryColor: '#123456' }),
  isLightColor: () => false,
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ auth: { setSession: vi.fn().mockResolvedValue({}) } }),
}))

import { SignInForm } from '../SignInForm'

const brandConfig = {
  name: 'Test Brand',
  primaryColor: '#123456',
} as unknown as BrandConfig

const originalLocation = window.location
const origin = originalLocation.origin
const locationReplace = vi.fn()

function stubLocation(search: string, hash = '') {
  // jsdom exposes `location` as a configurable own property, so it can be
  // swapped for a plain object whose `replace` is observable.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, hash, search, origin, replace: locationReplace },
  })
}

function renderWith(query: string) {
  searchParams = new URLSearchParams(query)
  stubLocation(query ? `?${query}` : '')
  return render(createElement(SignInForm, { brandConfig }))
}

describe('SignInForm post-sign-in navigation', () => {
  beforeEach(() => {
    push.mockClear()
    replace.mockClear()
    locationReplace.mockClear()
    localStorage.clear()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('hard-navigates to the sanitised redirectTo on a PKCE return', async () => {
    renderWith('code=abc&redirectTo=/events')
    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith('/events'))
    expect(push).not.toHaveBeenCalled()
  })

  it('soft-pushes to redirectTo for an already-signed-in visitor without a code', async () => {
    renderWith('redirectTo=/events')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/events'))
    expect(locationReplace).not.toHaveBeenCalled()
  })

  it('refuses a protocol-relative redirectTo on a PKCE return', async () => {
    renderWith('code=abc&redirectTo=//evil.example')
    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith('/'))
  })

  it('reduces an absolute same-origin redirectTo to its path', async () => {
    renderWith(`redirectTo=${encodeURIComponent(`${origin}/calendars/kubecon?joined=1`)}`)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/calendars/kubecon?joined=1'))
  })

  it('refuses an absolute URL stored in auth_redirect_to', async () => {
    localStorage.setItem('auth_redirect_to', 'https://evil.example/')
    renderWith('')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(localStorage.getItem('auth_redirect_to')).toBeNull()
  })

  it('honours a same-origin path stored in auth_redirect_to', async () => {
    localStorage.setItem('auth_redirect_to', '/events/42')
    renderWith('')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/events/42'))
  })

  it('refuses an off-site auth_redirect_to in the hash token flow', async () => {
    localStorage.setItem('auth_redirect_to', 'https://evil.example/')
    searchParams = new URLSearchParams()
    stubLocation('', '#access_token=a&refresh_token=b')
    render(createElement(SignInForm, { brandConfig }))
    await waitFor(() => expect(locationReplace).toHaveBeenCalledWith('/'))
    expect(push).not.toHaveBeenCalled()
  })
})
