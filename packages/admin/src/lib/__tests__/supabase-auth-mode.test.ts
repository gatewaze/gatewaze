import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// createClient is mocked so each test can read exactly what the module asked
// for. Under vitest import.meta.env follows vi.stubEnv (the runtime-config
// define only applies to `vite build`), as in supabase-flow-type.test.ts.
const RAW_AUTH = { tag: 'raw-gotrue-client' }
const createClient = vi.fn((..._args: unknown[]) => ({ auth: RAW_AUTH, from: vi.fn() }))
vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: (...args: unknown[]) => createClient(...args),
}))

async function freshModule() {
  vi.resetModules()
  return import('../supabase')
}

function lastCall(): [string, string, Record<string, unknown>] {
  const call = createClient.mock.calls.at(-1) as [string, string, Record<string, unknown>] | undefined
  if (!call) throw new Error('createClient was not called')
  return call
}

beforeEach(() => {
  createClient.mockClear()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('VITE_SUPABASE_FLOW_TYPE', '')
  vi.stubEnv('VITE_AUTH_MODE', '')
  vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/**
 * The open-source default must not move. These pin the exact createClient
 * call and the exported behaviour of origin/main's lib/supabase.ts when
 * VITE_AUTH_MODE is unset.
 */
describe('local mode (VITE_AUTH_MODE unset): unchanged from origin/main', () => {
  it('builds the client with exactly the original arguments', async () => {
    const mod = await freshModule()
    mod.getSupabase()

    expect(createClient).toHaveBeenCalledTimes(1)
    const [url, key, options] = lastCall()
    expect(url).toBe('https://project.supabase.co')
    expect(key).toBe('anon-key')
    expect(options).toStrictEqual({
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
        storage: window.localStorage,
        storageKey: 'gatewaze-admin-auth-token',
      },
    })
  })

  it('keeps the embed override (url, key, storage key, implicit flow)', async () => {
    vi.stubEnv('VITE_SUPABASE_FLOW_TYPE', 'pkce')
    const mod = await freshModule()
    mod.configureEmbedSupabase({ url: 'https://embed.supabase.co', anonKey: 'embed-key', storageKeySuffix: 'host' })
    mod.getSupabase()

    expect(lastCall()).toStrictEqual([
      'https://embed.supabase.co',
      'embed-key',
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'implicit',
          storage: window.localStorage,
          storageKey: 'gatewaze-admin-auth-token-host',
        },
      },
    ])
  })

  it('hands out the raw client and its own auth, unwrapped', async () => {
    const mod = await freshModule()
    const client = mod.getSupabase()

    expect(client).toBe(createClient.mock.results[0].value)
    expect(mod.supabase.auth).toBe(RAW_AUTH)
    expect(mod.isHostSession()).toBe(false)
    await expect(mod.getHostStatus()).resolves.toEqual({ status: 'signed_out' })
  })

  it('treats "local" and unknown values as local, warning only on unknown ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.stubEnv('VITE_AUTH_MODE', 'local')
    expect((await freshModule()).resolveAuthMode()).toBe('local')
    expect(warn).not.toHaveBeenCalled()

    vi.stubEnv('VITE_AUTH_MODE', 'HOST-SESSION')
    const mod = await freshModule()
    expect(mod.resolveAuthMode()).toBe('local')
    mod.getSupabase()
    expect(lastCall()[2]).toHaveProperty('auth.storageKey', 'gatewaze-admin-auth-token')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"HOST-SESSION"'))
    warn.mockRestore()
  })

  it('public URL defaults to VITE_SUPABASE_URL', async () => {
    const mod = await freshModule()
    expect(mod.getSupabasePublicUrl()).toBe('https://project.supabase.co')
  })
})

describe('host-session mode (VITE_AUTH_MODE=host-session)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AUTH_MODE', 'host-session')
    vi.stubEnv('VITE_SUPABASE_URL', window.location.origin)
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'https://project.supabase.co')
  })

  it('points the client at this origin with the anon key and a placeholder token only', async () => {
    const mod = await freshModule()
    mod.getSupabase()

    const [url, key, options] = lastCall()
    expect(url).toBe(window.location.origin)
    expect(key).toBe('anon-key')
    expect(Object.keys(options).sort()).toEqual(['accessToken', 'global'])
    await expect((options.accessToken as () => Promise<string>)()).resolves.toBe('host-session')
    // No auth storage options at all: nothing session-shaped is kept in the page.
    expect(options).not.toHaveProperty('auth')
  })

  it('swaps auth for the shim on both the export and getSupabase()', async () => {
    const mod = await freshModule()

    expect(mod.supabase.auth).not.toBe(RAW_AUTH)
    expect(mod.getSupabase().auth).toBe(mod.supabase.auth)
    expect(typeof mod.supabase.auth.getSession).toBe('function')
    expect(mod.isHostSession()).toBe(true)
  })

  it('keeps share and OAuth links on the real Supabase URL', async () => {
    const mod = await freshModule()
    expect(mod.getSupabasePublicUrl()).toBe('https://project.supabase.co')
  })

  it('makes getBrandSupabase() return the host-session client', async () => {
    vi.resetModules()
    const supabaseMod = await import('../supabase')
    const adminMod = await import('../supabaseAdmin')

    expect(adminMod.getBrandSupabase()).toBe(supabaseMod.getSupabase())
    expect(createClient).toHaveBeenCalledTimes(1)
  })
})

describe('configureHostSession', () => {
  const HOST = {
    baseUrl: `${window.location.origin}/api/gatewaze/supabase`,
    anonKey: 'anon-key',
    meUrl: '/api/gatewaze/session/me',
    logoutUrl: '/api/gatewaze/session/logout',
  }

  it('selects host-session mode for the embed whatever the env says', async () => {
    const mod = await freshModule()
    mod.configureHostSession(HOST)
    mod.getSupabase()

    expect(mod.resolveAuthMode()).toBe('host-session')
    expect(lastCall()[0]).toBe(HOST.baseUrl)
  })

  it('accepts an identical repeat call once the client exists', async () => {
    const mod = await freshModule()
    mod.configureHostSession(HOST)
    mod.getSupabase()

    expect(() => mod.configureHostSession({ ...HOST, onSignedOut: () => {} })).not.toThrow()
  })

  it.each([
    ['baseUrl', { baseUrl: `${window.location.origin}/other` }],
    ['anonKey', { anonKey: 'other' }],
    ['meUrl', { meUrl: '/other/me' }],
    ['logoutUrl', { logoutUrl: '/other/logout' }],
  ])('refuses a different %s once the client exists', async (_label, change) => {
    const mod = await freshModule()
    mod.configureHostSession(HOST)
    mod.getSupabase()

    expect(() => mod.configureHostSession({ ...HOST, ...change })).toThrow(/different configuration/)
  })

  it('cannot follow configureEmbedSupabase', async () => {
    const mod = await freshModule()
    mod.configureEmbedSupabase({ url: 'https://embed.supabase.co', anonKey: 'k' })

    expect(() => mod.configureHostSession(HOST)).toThrow(/one or the other/)
  })

  it('cannot be followed by configureEmbedSupabase', async () => {
    const mod = await freshModule()
    mod.configureHostSession(HOST)

    expect(() => mod.configureEmbedSupabase({ url: 'https://embed.supabase.co', anonKey: 'k' })).toThrow(/one or the other/)
  })
})

describe('mode resolution edge cases', () => {
  it('keeps an embed configured for localStorage local even when the env says host-session', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'host-session')
    const mod = await freshModule()
    mod.configureEmbedSupabase({ url: 'https://embed.supabase.co', anonKey: 'k' })
    mod.getSupabase()

    expect(mod.resolveAuthMode()).toBe('local')
    expect(lastCall()[2]).toHaveProperty('auth.storageKey', 'gatewaze-admin-auth-token-host_embed')
  })

  it('throws in host-session mode without an anon key', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'host-session')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const mod = await freshModule()

    expect(() => mod.getSupabase()).toThrow(/VITE_SUPABASE_ANON_KEY/)
  })

  it('freezes the mode once the client is built', async () => {
    const mod = await freshModule()
    mod.getSupabase()

    vi.stubEnv('VITE_AUTH_MODE', 'host-session')

    expect(mod.isHostSession()).toBe(false)
    expect(mod.resolveAuthMode()).toBe('local')
  })

  it('warns about an unknown value only once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('VITE_AUTH_MODE', 'cookie')
    const mod = await freshModule()

    mod.resolveAuthMode()
    mod.resolveAuthMode()
    mod.isHostSession()

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('host-session wiring through lib/supabase', () => {
  const HOST = {
    baseUrl: `${window.location.origin}/api/gatewaze/supabase`,
    anonKey: 'anon-key',
    meUrl: '/api/gatewaze/session/me',
    logoutUrl: '/api/gatewaze/session/logout',
  }
  let assign: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: window.location.origin, pathname: '/x', search: '', assign })
    fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('standalone: signInWithOAuth goes to /bff/login and the defaults are /bff/me and /bff/logout', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'host-session')
    const mod = await freshModule()

    await mod.supabase.auth.signInWithOAuth({ provider: 'custom:lfid', options: { redirectTo: `${window.location.origin}/login` } })
    expect(assign).toHaveBeenCalledWith('/bff/login?return_to=%2Flogin')

    await mod.getHostStatus()
    expect(fetchMock).toHaveBeenCalledWith('/bff/me', expect.objectContaining({ credentials: 'include' }))

    await mod.supabase.auth.signOut()
    expect(fetchMock).toHaveBeenLastCalledWith('/bff/logout', expect.objectContaining({ method: 'POST' }))
  })

  it('embedded: signInWithOAuth calls the host hook and does not navigate', async () => {
    const mod = await freshModule()
    const hook = vi.fn()
    mod.configureHostSession({ ...HOST, onSignedOut: hook })

    await mod.supabase.auth.signInWithOAuth({ provider: 'custom:lfid' })

    expect(hook).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalled()
  })

  it('a re-mount with a new hook uses the new hook and is not born signed out', async () => {
    const mod = await freshModule()
    const first = vi.fn()
    const second = vi.fn()
    mod.configureHostSession({ ...HOST, onSignedOut: first })
    mod.getSupabase()
    ;(mod.supabase.auth as unknown as { signedOut: () => void }).signedOut()
    expect(first).toHaveBeenCalledTimes(1)
    fetchMock.mockClear()

    mod.configureHostSession({ ...HOST, onSignedOut: second })

    // The latch is cleared, so the new mount asks the session holder again.
    await mod.getHostStatus()
    expect(fetchMock).toHaveBeenCalledWith(HOST.meUrl, expect.anything())
    ;(mod.supabase.auth as unknown as { signedOut: () => void }).signedOut()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })
})

describe('VITE_SUPABASE_PUBLIC_URL checks', () => {
  it.each([
    ['plain http on a real host', 'http://project.supabase.co'],
    ['javascript:', 'javascript:alert(1)'],
    ['not a URL', 'project.supabase.co'],
  ])('ignores %s and falls back to VITE_SUPABASE_URL, warning once', async (_label, value) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', value)
    const mod = await freshModule()

    expect(mod.getSupabasePublicUrl()).toBe('https://project.supabase.co')
    mod.getSupabasePublicUrl()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('accepts http on a *.localhost dev host', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'http://supabase.gatewaze.localhost')
    const mod = await freshModule()

    expect(mod.getSupabasePublicUrl()).toBe('http://supabase.gatewaze.localhost')
  })

  it.each(['http://evil.example', 'http://localhost.evil.example'])('rejects http on %s', async (value) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', value)
    const mod = await freshModule()

    expect(mod.getSupabasePublicUrl()).toBe('https://project.supabase.co')
    warn.mockRestore()
  })

  it('accepts http on localhost', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'http://localhost:54321')
    const mod = await freshModule()

    expect(mod.getSupabasePublicUrl()).toBe('http://localhost:54321')
  })

  it('standalone host-session: warns once when the public URL is just the admin origin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('VITE_AUTH_MODE', 'host-session')
    vi.stubEnv('VITE_SUPABASE_URL', window.location.origin)
    const mod = await freshModule()

    mod.getSupabase()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('VITE_SUPABASE_PUBLIC_URL is unset or equals the admin origin'))
    warn.mockRestore()
  })

  it('standalone host-session: no warning when the public URL is the real project', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('VITE_AUTH_MODE', 'host-session')
    vi.stubEnv('VITE_SUPABASE_URL', window.location.origin)
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'https://project.supabase.co')
    const mod = await freshModule()

    mod.getSupabase()

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('configureHostSession latch handling', () => {
  it('an identical repeat call with the same hook does not reset the latch', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const mod = await freshModule()
    const hook = vi.fn()
    const HOST = { baseUrl: `${window.location.origin}/p`, anonKey: 'anon-key', meUrl: '/me', logoutUrl: '/logout', onSignedOut: hook }
    mod.configureHostSession(HOST)
    mod.getSupabase()
    ;(mod.supabase.auth as unknown as { signedOut: () => void }).signedOut()
    fetchMock.mockClear()

    mod.configureHostSession(HOST)

    await expect(mod.getHostStatus()).resolves.toEqual({ status: 'signed_out' })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
