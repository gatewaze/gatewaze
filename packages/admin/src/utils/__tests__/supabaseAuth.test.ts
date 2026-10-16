import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

let hostSession = false
const signOut = vi.fn()
const getUser = vi.fn()
const maybeSingle = vi.fn()
let authListener: ((event: string, session: unknown) => Promise<void>) | null = null
const getHostAdminContext = vi.fn()

vi.mock('@/lib/supabase', () => ({
  isHostSession: () => hostSession,
  getHostAdminContext: (id: string) => getHostAdminContext(id),
  supabase: {
    auth: {
      signOut: () => signOut(),
      getUser: () => getUser(),
      onAuthStateChange: (cb: (event: string, session: unknown) => Promise<void>) => {
        authListener = cb
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }) }),
  },
}))

const { SupabaseAuthService } = await import('../supabaseAuth')

const PROFILE = {
  id: 'p1', email: 'a@example.org', name: 'A', role: 'admin', is_active: true,
  created_at: '2026-01-01', updated_at: '2026-01-01',
}

beforeEach(() => {
  hostSession = false
  toastError.mockClear()
  signOut.mockReset()
  getUser.mockReset()
  maybeSingle.mockReset()
  getHostAdminContext.mockReset()
  getHostAdminContext.mockReturnValue(null)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SupabaseAuthService.signOut', () => {
  it('local mode: returns the error but stays silent, as before', async () => {
    signOut.mockResolvedValue({ error: new Error('network') })

    await expect(SupabaseAuthService.signOut()).resolves.toEqual({ error: 'network' })
    expect(toastError).not.toHaveBeenCalled()
  })

  it('host-session mode: tells the user', async () => {
    hostSession = true
    signOut.mockResolvedValue({ error: new Error('Sign-out failed (500)') })

    await SupabaseAuthService.signOut()

    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('reports a thrown error', async () => {
    signOut.mockRejectedValue(new Error('boom'))

    await expect(SupabaseAuthService.signOut()).resolves.toEqual({ error: 'boom' })
  })
})

describe('SupabaseAuthService.getCurrentUser reasons', () => {
  it('no session is a definite no_user', async () => {
    const missing = Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError' })
    getUser.mockResolvedValue({ data: { user: null }, error: missing })

    await expect(SupabaseAuthService.getCurrentUser()).resolves.toMatchObject({ user: null, reason: 'no_user' })
  })

  it('no user and no error is a definite no_user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })

    await expect(SupabaseAuthService.getCurrentUser()).resolves.toMatchObject({ user: null, reason: 'no_user' })
  })

  it('a thrown error is lookup_failed', async () => {
    getUser.mockRejectedValue(new Error('offline'))

    await expect(SupabaseAuthService.getCurrentUser()).resolves.toMatchObject({ user: null, reason: 'lookup_failed' })
  })

  it('any other auth error is lookup_failed', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' }) })

    await expect(SupabaseAuthService.getCurrentUser()).resolves.toMatchObject({ user: null, reason: 'lookup_failed' })
  })

  it.each([401, 403])('GoTrue rejecting the token (AuthApiError %i) is a definite no_user', async (status) => {
    getUser.mockResolvedValue({ data: { user: null }, error: Object.assign(new Error('invalid JWT'), { name: 'AuthApiError', status }) })

    await expect(SupabaseAuthService.getCurrentUser()).resolves.toMatchObject({ user: null, reason: 'no_user' })
  })

  it('a GoTrue 500 is lookup_failed', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: Object.assign(new Error('boom'), { name: 'AuthApiError', status: 500 }) })

    await expect(SupabaseAuthService.getCurrentUser()).resolves.toMatchObject({ user: null, reason: 'lookup_failed' })
  })

  it('a profile query error is lookup_failed, not not_admin', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.org' } }, error: null })
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })

    await expect(SupabaseAuthService.getCurrentUser()).resolves.toMatchObject({ user: null, reason: 'lookup_failed' })
  })

  it('no profile row is not_admin', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.org' } }, error: null })
    maybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(SupabaseAuthService.getCurrentUser()).resolves.toMatchObject({ user: null, reason: 'not_admin' })
  })
})

describe('SupabaseAuthService.onAuthStateChange outcomes', () => {
  async function fire(event: string) {
    const callback = vi.fn()
    SupabaseAuthService.onAuthStateChange(callback)
    await authListener!(event, event === 'SIGNED_OUT' ? null : { user: { id: 'u1' } })
    return callback
  }

  it('SIGNED_IN with an admin profile -> signed_in', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.org' } }, error: null })
    maybeSingle.mockResolvedValue({ data: PROFILE, error: null })

    expect(await fire('SIGNED_IN')).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'signed_in', 'u1')
  })

  it('SIGNED_IN whose profile lookup fails -> lookup_failed', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.org' } }, error: null })
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })

    expect(await fire('SIGNED_IN')).toHaveBeenCalledWith(null, 'lookup_failed', 'u1')
  })

  it('SIGNED_IN without an admin profile -> not_admin', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.org' } }, error: null })
    maybeSingle.mockResolvedValue({ data: null, error: null })

    expect(await fire('SIGNED_IN')).toHaveBeenCalledWith(null, 'not_admin', 'u1')
  })

  it('SIGNED_IN with no user behind the session -> signed_out', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })

    expect(await fire('SIGNED_IN')).toHaveBeenCalledWith(null, 'signed_out', 'u1')
  })

  it('SIGNED_OUT -> signed_out', async () => {
    expect(await fire('SIGNED_OUT')).toHaveBeenCalledWith(null, 'signed_out')
  })
})

describe('SupabaseAuthService.getCurrentUser with an admin context from /me', () => {
  const HOST_PROFILE = {
    id: 'p1', user_id: 'u1', email: 'a@example.org', name: 'A', role: 'editor', avatar_url: null,
    is_active: true as const, created_at: '2026-01-01', updated_at: '2026-01-02',
  }

  it('uses the profile /me sent for this auth user and skips the admin_profiles query', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.org' } }, error: null })
    getHostAdminContext.mockReturnValue({ profile: HOST_PROFILE, features: [] })

    const result = await SupabaseAuthService.getCurrentUser()

    expect(getHostAdminContext).toHaveBeenCalledWith('u1')
    expect(maybeSingle).not.toHaveBeenCalled()
    expect(result).toEqual({
      user: {
        id: 'p1', email: 'a@example.org', name: 'A', role: 'editor', avatar_url: undefined,
        permissions: undefined, is_active: true, created_at: '2026-01-01', updated_at: '2026-01-02',
      },
      error: null,
    })
  })

  it('falls back to the query when /me sent none (or it went stale)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.org' } }, error: null })
    maybeSingle.mockResolvedValue({ data: PROFILE, error: null })

    const result = await SupabaseAuthService.getCurrentUser()

    expect(maybeSingle).toHaveBeenCalledTimes(1)
    expect(result.user?.id).toBe('p1')
  })

  it('maps a profile the same way from /me and from the query', async () => {
    const row = { ...HOST_PROFILE, avatar_url: 'avatars/a.png' }
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.org' } }, error: null })
    getHostAdminContext.mockReturnValue({ profile: row, features: [] })
    const fromMe = await SupabaseAuthService.getCurrentUser()
    getHostAdminContext.mockReturnValue(null)
    maybeSingle.mockResolvedValue({ data: row, error: null })
    const fromQuery = await SupabaseAuthService.getCurrentUser()
    expect(fromMe).toEqual(fromQuery)
  })
})

