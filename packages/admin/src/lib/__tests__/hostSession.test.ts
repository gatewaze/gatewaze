import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAuthError } from '@supabase/supabase-js'

import {
  createHostAuth,
  HOST_SESSION_TOKEN,
  hostSessionFetch,
  NOT_ADMIN_CACHE_MS,
  safeReturnTo,
  signInUrl,
  type HostAuthOptions,
} from '../hostSession'

const USER = { id: 'user-1', email: 'admin@example.org', aud: 'authenticated' }

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function makeAuth(overrides: Partial<HostAuthOptions> = {}) {
  return createHostAuth({
    meUrl: '/bff/me',
    logoutUrl: '/bff/logout',
    anonKey: 'anon-key',
    embedded: false,
    ...overrides,
  })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('host-session auth shim: session', () => {
  it('builds a placeholder session from /bff/me, never a real token', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()

    const { data, error } = await auth.getSession()

    expect(error).toBeNull()
    expect(data.session?.access_token).toBe(HOST_SESSION_TOKEN)
    expect(data.session?.refresh_token).toBe(HOST_SESSION_TOKEN)
    expect(data.session?.user).toEqual(USER)
    // Far enough out that nothing in the page tries to refresh it.
    expect(data.session!.expires_at!).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 3600)
    expect(fetchMock).toHaveBeenCalledWith('/bff/me', {
      credentials: 'include',
      headers: { apikey: 'anon-key' },
      signal: expect.any(AbortSignal),
    })
  })

  it('caches /bff/me across getSession and getUser', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()

    await auth.getSession()
    const { data } = await auth.getUser()

    expect(data.user).toEqual(USER)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['401 (signed out)', 401, {}],
    ['403 (not an admin)', 403, { error: 'not_admin', email: 'someone@example.org' }],
  ])('returns a null session on %s', async (_label, status, body) => {
    fetchMock.mockResolvedValueOnce(json(status, body))
    const auth = makeAuth()

    const { data } = await auth.getSession()

    expect(data.session).toBeNull()
  })

  it('reports not_admin with the email from a 403', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: 'not_admin', email: 'someone@example.org' }))
    const auth = makeAuth()

    await expect(auth.me()).resolves.toEqual({ status: 'not_admin', email: 'someone@example.org' })
  })

  it('does not cache a 5xx, so the next call asks again', async () => {
    fetchMock.mockResolvedValueOnce(json(502, {})).mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()

    expect((await auth.getSession()).data.session).toBeNull()
    expect((await auth.getSession()).data.session?.user).toEqual(USER)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('host-session auth shim: onAuthStateChange', () => {
  it('delivers INITIAL_SESSION on subscribe', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()
    const listener = vi.fn()

    auth.onAuthStateChange(listener)
    await flush()

    expect(listener).toHaveBeenCalledWith('INITIAL_SESSION', expect.objectContaining({ access_token: HOST_SESSION_TOKEN }))
  })

  it('stops delivering events after unsubscribe', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()
    const listener = vi.fn()

    const { data } = auth.onAuthStateChange(listener)
    data.subscription.unsubscribe()
    await flush()
    auth.signedOut()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('host-session fetch: expiry marker', () => {
  it('signs out when a 401 carries x-gw-session: expired', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { user: USER }))
      .mockResolvedValueOnce(json(401, {}, { 'x-gw-session': 'expired' }))
    const auth = makeAuth()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    await flush()

    const res = await hostSessionFetch(() => auth.signedOut())('/rest/v1/events', { method: 'GET' })

    expect(res.status).toBe(401)
    expect(listener).toHaveBeenCalledWith('SIGNED_OUT', null)
    expect((await auth.getSession()).data.session).toBeNull()
  })

  it('leaves a plain 401 to the caller (no SIGNED_OUT)', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { message: 'JWT expired' }))
    const onExpired = vi.fn()

    const res = await hostSessionFetch(onExpired)('/functions/v1/x', { method: 'POST' })

    expect(res.status).toBe(401)
    expect(onExpired).not.toHaveBeenCalled()
  })

  it('sends the cookie on every request', async () => {
    fetchMock.mockResolvedValueOnce(json(200, []))

    await hostSessionFetch(() => {})('/rest/v1/events', { method: 'GET', headers: { a: 'b' } })

    expect(fetchMock).toHaveBeenCalledWith('/rest/v1/events', {
      method: 'GET',
      headers: { a: 'b' },
      credentials: 'include',
    })
  })

  it('emits SIGNED_OUT once for a burst of expired responses', async () => {
    const auth = makeAuth()
    const listener = vi.fn()
    fetchMock.mockResolvedValueOnce(json(401, {}))
    auth.onAuthStateChange(listener)
    await flush()

    auth.signedOut()
    auth.signedOut()

    expect(listener.mock.calls.filter(([event]) => event === 'SIGNED_OUT')).toHaveLength(1)
  })

  it('hands the lost session to the host hook when embedded', async () => {
    const hook = vi.fn()
    const auth = makeAuth({ embedded: true, getHostHook: () => hook })

    auth.signedOut()

    expect(hook).toHaveBeenCalledTimes(1)
  })
})

describe('host-session auth shim: signOut', () => {
  it('POSTs the logout route with the apikey, then emits SIGNED_OUT', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(new Response(null, { status: 204 }))
    const auth = makeAuth({ logoutUrl: '/api/gatewaze/session/logout' })
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    await flush()

    const { error } = await auth.signOut()

    expect(error).toBeNull()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/gatewaze/session/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { apikey: 'anon-key' },
    })
    expect(listener).toHaveBeenLastCalledWith('SIGNED_OUT', null)
  })

  it('still signs out locally, and reports the error, when the POST fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))
    const auth = makeAuth()

    const { error } = await auth.signOut()

    expect(isAuthError(error)).toBe(true)
    await expect(auth.me()).resolves.toEqual({ status: 'signed_out' })
  })
})

describe('host-session auth shim: unsupported methods', () => {
  it.each([
    ['signInWithOtp', (auth: ReturnType<typeof makeAuth>) => auth.signInWithOtp()],
    ['admin.createUser', (auth: ReturnType<typeof makeAuth>) => (auth.admin as { createUser: () => Promise<unknown> }).createUser()],
    ['admin.deleteUser', (auth: ReturnType<typeof makeAuth>) => (auth.admin as { deleteUser: () => Promise<unknown> }).deleteUser()],
  ])('%s returns an AuthError instead of throwing', async (name, call) => {
    const auth = makeAuth()

    const result = (await call(auth)) as { data: { user: unknown; session: unknown }; error: unknown }

    expect(result.data).toEqual({ user: null, session: null })
    expect(isAuthError(result.error)).toBe(true)
    expect((result.error as Error).message).toContain(`supabase.auth.${name}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws a clear error for any other auth method', () => {
    const auth = makeAuth() as unknown as Record<string, () => unknown>

    expect(() => auth.signInWithPassword()).toThrow(/supabase\.auth\.signInWithPassword is not available in host-session mode/)
    expect(() => auth.refreshSession()).toThrow(/host-session mode/)
  })

  it('throws a clear error for any other admin method', () => {
    const auth = makeAuth()
    const admin = auth.admin as unknown as Record<string, () => unknown>

    expect(() => admin.listUsers()).toThrow(/supabase\.auth\.admin\.listUsers is not available/)
  })

  it('stays undefined for `then` and symbols, so awaiting or inspecting it is safe', async () => {
    const auth = makeAuth() as unknown as Record<string | symbol, unknown>

    expect(auth.then).toBeUndefined()
    expect(auth[Symbol.toStringTag]).toBeUndefined()
  })

  it('makes auto-refresh a no-op', async () => {
    const auth = makeAuth()

    await expect(auth.startAutoRefresh()).resolves.toBeUndefined()
    await expect(auth.stopAutoRefresh()).resolves.toBeUndefined()
  })
})

describe('host-session auth shim: signInWithOAuth', () => {
  it('standalone: sends the browser to /bff/login with the same-origin return path', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: window.location.origin, assign })
    const auth = makeAuth()

    const { data, error } = await auth.signInWithOAuth({
      provider: 'custom:lfid',
      options: { redirectTo: `${window.location.origin}/login?x=1` },
    })

    expect(error).toBeNull()
    expect(assign).toHaveBeenCalledWith('/bff/login?return_to=%2Flogin%3Fx%3D1')
    expect(data.url).toBe('/bff/login?return_to=%2Flogin%3Fx%3D1')
  })

  it('embedded: hands sign-in to the host hook and does not navigate', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: window.location.origin, assign })
    const hook = vi.fn()
    const auth = makeAuth({ embedded: true, getHostHook: () => hook })

    const { error } = await auth.signInWithOAuth({ provider: 'custom:lfid' })

    expect(error).toBeNull()
    expect(hook).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('signInUrl / safeReturnTo', () => {
  it('keeps a same-origin path', () => {
    expect(signInUrl('/events/42?tab=x')).toBe('/bff/login?return_to=%2Fevents%2F42%3Ftab%3Dx')
  })

  it.each([
    ['protocol-relative', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['absolute URL', 'https://evil.example/'],
    ['relative path', 'events'],
    ['control character', '/a\nb'],
    ['empty', ''],
  ])('collapses a %s return path to /', (_label, value) => {
    expect(safeReturnTo(value)).toBe('/')
  })
})

describe('host-session auth shim: /bff/me caching', () => {
  it('does not cache a network failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()

    expect((await auth.getSession()).data.session).toBeNull()
    expect((await auth.getSession()).data.session?.user).toEqual(USER)
  })

  it('warns about, and does not cache, a 200 without a user', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(json(200, { nope: true })).mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()

    expect((await auth.getSession()).data.session).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('200 without a user'))
    expect((await auth.getSession()).data.session?.user).toEqual(USER)
  })

  it('caches a 401 for the life of the page', async () => {
    fetchMock.mockResolvedValue(json(401, {}))
    const auth = makeAuth()

    await auth.getSession()
    await auth.getSession()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-checks a 403 (not_admin) once the short window has passed', async () => {
    vi.useFakeTimers()
    try {
      fetchMock
        .mockResolvedValueOnce(json(403, { error: 'not_admin' }))
        .mockResolvedValueOnce(json(200, { user: USER }))
      const auth = makeAuth()

      expect((await auth.me()).status).toBe('not_admin')
      expect((await auth.me()).status).toBe('not_admin')
      expect(fetchMock).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(NOT_ADMIN_CACHE_MS)

      expect((await auth.me()).status).toBe('ok')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a sign-out that lands while /bff/me is in flight', async () => {
    let resolveMe: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (resolveMe = resolve)))
    const auth = makeAuth()

    const first = auth.getSession()
    auth.signedOut()
    resolveMe(json(502, {}))
    await first

    // The in-flight 5xx must not clear the signed-out answer the latch set.
    await expect(auth.me()).resolves.toEqual({ status: 'signed_out' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('host-session auth shim: robustness', () => {
  it('contains a throwing listener and a throwing host hook', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(json(401, {}))
    const auth = makeAuth({
      embedded: true,
      getHostHook: () => () => {
        throw new Error('hook')
      },
    })
    const second = vi.fn()
    auth.onAuthStateChange(() => {
      throw new Error('listener')
    })
    auth.onAuthStateChange(second)
    await flush()

    expect(() => auth.signedOut()).not.toThrow()
    expect(second).toHaveBeenCalledWith('SIGNED_OUT', null)
    expect(error).toHaveBeenCalledWith('[host-session] onSignedOut hook failed', expect.any(Error))
  })

  it('does not sign out on a 200 that carries the expiry header', async () => {
    fetchMock.mockResolvedValueOnce(json(200, [], { 'x-gw-session': 'expired' }))
    const onExpired = vi.fn()

    await hostSessionFetch(onExpired)('/rest/v1/events', {})

    expect(onExpired).not.toHaveBeenCalled()
  })

  it('reports a failed logout POST and still signs this page out', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(500, {}))
    const auth = makeAuth()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    await flush()

    const { error } = await auth.signOut()

    expect(isAuthError(error)).toBe(true)
    expect(error?.status).toBe(500)
    expect(listener).toHaveBeenLastCalledWith('SIGNED_OUT', null)
  })

  it('keeps then and symbols undefined on auth.admin too', () => {
    const admin = makeAuth().admin as unknown as Record<string | symbol, unknown>

    expect(admin.then).toBeUndefined()
    expect(admin[Symbol.iterator]).toBeUndefined()
  })
})

describe('host-session auth shim: signed-out latch', () => {
  it('emits SIGNED_OUT again, and asks /bff/me again, after resetSignedOut', async () => {
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    await flush()

    auth.signedOut()
    auth.resetSignedOut()

    expect((await auth.getSession()).data.session?.user).toEqual(USER)
    auth.signedOut()
    expect(listener.mock.calls.filter(([event]) => event === 'SIGNED_OUT')).toHaveLength(2)
  })
})

describe('host-session auth shim: signInWithOAuth edge cases', () => {
  it('sends a cross-origin redirectTo back to /', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: window.location.origin, assign })

    await makeAuth().signInWithOAuth({ provider: 'custom:lfid', options: { redirectTo: 'https://evil.example/x' } })

    expect(assign).toHaveBeenCalledWith('/bff/login?return_to=%2F')
  })

  it('returns an error when embedded without a host hook', async () => {
    const { error } = await makeAuth({ embedded: true }).signInWithOAuth({ provider: 'custom:lfid' })

    expect(isAuthError(error)).toBe(true)
  })
})

describe('host-session auth shim: pending and unavailable', () => {
  it('maps 503 admin_check_pending to pending with Retry-After, uncached and with no SIGNED_OUT', async () => {
    fetchMock
      .mockResolvedValueOnce(json(503, { error: 'admin_check_pending' }, { 'retry-after': '3' }))
      .mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    await flush()

    expect(listener).toHaveBeenCalledWith('INITIAL_SESSION', null)
    expect(listener).not.toHaveBeenCalledWith('SIGNED_OUT', null)
    expect((await auth.getSession()).data.session?.user).toEqual(USER)
  })

  it('reports the pending Retry-After in milliseconds, with sane bounds', async () => {
    fetchMock
      .mockResolvedValueOnce(json(503, { error: 'admin_check_pending' }, { 'retry-after': '3' }))
      .mockResolvedValueOnce(json(503, { error: 'admin_check_pending' }, { 'retry-after': 'soon' }))
      .mockResolvedValueOnce(json(503, { error: 'admin_check_pending' }, { 'retry-after': '3600' }))
    const auth = makeAuth()

    await expect(auth.me()).resolves.toEqual({ status: 'pending', retryAfterMs: 3000 })
    await expect(auth.me()).resolves.toEqual({ status: 'pending', retryAfterMs: 2000 })
    await expect(auth.me()).resolves.toEqual({ status: 'pending', retryAfterMs: 30000 })
  })

  it.each([
    ['503 session_unavailable', () => json(503, { error: 'session_unavailable' })],
    ['502', () => json(502, {})],
    ['500', () => json(500, {})],
  ])('maps %s to unavailable, not signed_out, and does not cache it', async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()

    await expect(auth.me()).resolves.toEqual({ status: 'unavailable' })
    expect((await auth.getSession()).data.session?.user).toEqual(USER)
  })

  it('floors a tiny Retry-After at 500ms, so a hostile header cannot spin the page', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: 'admin_check_pending' }, { 'retry-after': '0.01' }))

    await expect(makeAuth().me()).resolves.toEqual({ status: 'pending', retryAfterMs: 500 })
  })

  it('maps a network failure to unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))

    await expect(makeAuth().me()).resolves.toEqual({ status: 'unavailable' })
  })

  it('a proxied 503 admin_check_pending does not sign out (only the 401 marker does)', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: 'admin_check_pending' }, { 'retry-after': '1' }))
    const onExpired = vi.fn()

    const res = await hostSessionFetch(onExpired)('/rest/v1/events', {})

    expect(res.status).toBe(503)
    expect(onExpired).not.toHaveBeenCalled()
  })
})

describe('host-session auth shim: host hook on failed sign-out', () => {
  it('does not run the host hook when the logout POST failed', async () => {
    fetchMock.mockResolvedValueOnce(json(500, {}))
    const hook = vi.fn()
    const auth = makeAuth({ embedded: true, getHostHook: () => hook })

    const { error } = await auth.signOut()

    expect(error).not.toBeNull()
    expect(hook).not.toHaveBeenCalled()
  })

  it('runs the host hook when the logout POST succeeded', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const hook = vi.fn()
    const auth = makeAuth({ embedded: true, getHostHook: () => hook })

    await auth.signOut()

    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('contains a host hook that throws during embedded sign-in', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const auth = makeAuth({
      embedded: true,
      getHostHook: () => () => {
        throw new Error('host broke')
      },
    })

    const { error } = await auth.signInWithOAuth({ provider: 'custom:lfid' })

    expect(isAuthError(error)).toBe(true)
  })
})

describe('host-session auth shim: pinned details', () => {
  it('pins the not_admin cache window at 15s', () => {
    expect(NOT_ADMIN_CACHE_MS).toBe(15_000)
  })

  it('pins expires_in at a year', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: USER }))

    const { data } = await makeAuth().getSession()

    expect(data.session?.expires_in).toBe(365 * 24 * 3600)
  })

  it('ignores a non-string email on a 403', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: 'not_admin', email: 5 }))

    await expect(makeAuth().me()).resolves.toEqual({ status: 'not_admin', email: undefined })
  })

  it('treats a 200 whose user has no id as unavailable (no session), not ok', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(json(200, { user: {} }))
    const auth = makeAuth()

    await expect(auth.me()).resolves.toEqual({ status: 'unavailable' })
  })

  it('contains an async listener that rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(json(401, {}))
    const auth = makeAuth()
    auth.onAuthStateChange(async () => {
      throw new Error('async listener')
    })
    await flush()

    auth.signedOut()
    await flush()

    expect(error).toHaveBeenCalledWith('[host-session] auth listener failed', expect.any(Error))
  })

  it('standalone signInWithOAuth with no options returns to the current path', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: window.location.origin, pathname: '/', search: '', assign })

    await makeAuth().signInWithOAuth({ provider: 'custom:lfid' })

    expect(assign).toHaveBeenCalledWith('/bff/login?return_to=%2F')
  })
})

describe('host-session auth shim: access arriving', () => {
  it('Retry-After: 0 falls back to the 2s default', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: 'admin_check_pending' }, { 'retry-after': '0' }))

    await expect(makeAuth().me()).resolves.toEqual({ status: 'pending', retryAfterMs: 2000 })
  })

  it.each([
    ['pending', () => json(503, { error: 'admin_check_pending' }, { 'retry-after': '1' })],
    ['unavailable', () => json(502, {})],
  ])('emits SIGNED_IN when %s turns ok', async (_label, first) => {
    fetchMock.mockResolvedValueOnce(first()).mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    await flush()

    await auth.me()

    expect(listener).toHaveBeenCalledWith('SIGNED_IN', expect.objectContaining({ access_token: HOST_SESSION_TOKEN, user: USER }))
  })

  it('emits SIGNED_IN when a re-checked not_admin turns ok', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockResolvedValueOnce(json(403, { error: 'not_admin' })).mockResolvedValueOnce(json(200, { user: USER }))
      const auth = makeAuth()
      const listener = vi.fn()
      auth.onAuthStateChange(listener)
      await vi.advanceTimersByTimeAsync(0)
      vi.advanceTimersByTime(NOT_ADMIN_CACHE_MS)

      await auth.me()

      expect(listener).toHaveBeenCalledWith('SIGNED_IN', expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not emit SIGNED_IN for an ok on the first answer', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: USER }))
    const auth = makeAuth()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    await flush()
    await auth.me()

    expect(listener).not.toHaveBeenCalledWith('SIGNED_IN', expect.anything())
  })
})

describe('host-session auth shim: bounded /me and the in-flight guard', () => {
  it('abandons a hung /me after the timeout and reports unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const auth = makeAuth({ meTimeoutMs: 20 })

    await expect(auth.me()).resolves.toEqual({ status: 'unavailable' })
  })

  it('an ok that lands after signOut() does not emit SIGNED_IN', async () => {
    let resolveMe: (r: Response) => void = () => {}
    fetchMock
      .mockResolvedValueOnce(json(503, { error: 'admin_check_pending' }, { 'retry-after': '1' }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => (resolveMe = resolve)))
    const auth = makeAuth()
    const listener = vi.fn()
    auth.onAuthStateChange(listener)
    await flush()

    const inFlight = auth.me()
    auth.signedOut()
    resolveMe(json(200, { user: USER }))
    await inFlight

    expect(listener).not.toHaveBeenCalledWith('SIGNED_IN', expect.anything())
  })
})
