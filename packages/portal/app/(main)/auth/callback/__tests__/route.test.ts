import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Pins the server-side redirect sink: the route must reduce `redirectTo`
// through sameOriginPath with the request origin as an allowed origin, so an
// off-site target collapses to `/` and an absolute same-origin target keeps
// its path.

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: vi.fn() }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: async () => ({
        data: { session: { user: { email: 'person@example.test' } } },
        error: null,
      }),
    },
  }),
}))

import { GET } from '../route'

async function locationFor(query: string): Promise<string | null> {
  const response = await GET(new NextRequest(`http://app.test/auth/callback?${query}`))
  return response.headers.get('location')
}

describe('auth callback redirect target', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('keeps a same-origin path', async () => {
    expect(await locationFor('code=x&redirectTo=/events/42')).toBe('http://app.test/events/42')
  })

  it('collapses an off-site protocol-relative target to the home page', async () => {
    expect(await locationFor('code=x&redirectTo=//evil.example')).toBe('http://app.test/')
  })

  it('collapses an off-site absolute target to the home page', async () => {
    expect(await locationFor(`code=x&redirectTo=${encodeURIComponent('https://evil.example/x')}`)).toBe('http://app.test/')
  })

  it('reduces an absolute target on the request origin to its path', async () => {
    expect(await locationFor(`code=x&redirectTo=${encodeURIComponent('http://app.test/events?tab=1')}`)).toBe(
      'http://app.test/events?tab=1',
    )
  })
})
