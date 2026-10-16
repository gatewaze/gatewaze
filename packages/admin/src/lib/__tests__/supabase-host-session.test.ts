import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real supabase-js (no mock): proves the installed version honours the
// top-level accessToken option for REST, Storage and Functions, and that the
// wrapped client's own fetch carries the cookie and the expiry marker.
const USER = { id: 'user-1', email: 'admin@example.org', aud: 'authenticated' }

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function routeFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return handler(url, init)
  })
}

function headerOf(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name)
}

async function freshModule() {
  vi.resetModules()
  return import('../supabase')
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.stubEnv('VITE_AUTH_MODE', 'host-session')
  vi.stubEnv('VITE_SUPABASE_URL', window.location.origin)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('host-session client against the real supabase-js', () => {
  it('sends the placeholder, the anon key and the cookie on a PostgREST call', async () => {
    const fetchMock = routeFetch(() => json(200, []))
    vi.stubGlobal('fetch', fetchMock)
    const { supabase } = await freshModule()

    await supabase.from('events').select('id')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url.startsWith(`${window.location.origin}/rest/v1/events`)).toBe(true)
    expect(headerOf(init, 'authorization')).toBe('Bearer host-session')
    expect(headerOf(init, 'apikey')).toBe('anon-key')
    expect(init.credentials).toBe('include')
  })

  it('sends the placeholder on functions.invoke', async () => {
    const fetchMock = routeFetch(() => json(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { supabase } = await freshModule()

    await supabase.functions.invoke('do-thing', { body: { a: 1 } })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${window.location.origin}/functions/v1/do-thing`)
    expect(headerOf(init, 'authorization')).toBe('Bearer host-session')
  })

  it('authenticates Realtime with the placeholder from construction, on this origin', async () => {
    vi.stubGlobal('fetch', routeFetch(() => json(200, [])))
    const { getSupabase } = await freshModule()

    const client = getSupabase()
    await flush()

    expect(client.realtime.accessTokenValue).toBe('host-session')
    expect(client.realtime.endPoint.startsWith(window.location.origin.replace(/^http/, 'ws'))).toBe(true)
  })

  it('gives getSession() callers the placeholder token', async () => {
    vi.stubGlobal('fetch', routeFetch((url) => (url === '/bff/me' ? json(200, { user: USER }) : json(404, {}))))
    const { supabase } = await freshModule()

    const { data } = await supabase.auth.getSession()

    expect(data.session?.access_token).toBe('host-session')
    expect(data.session?.user.id).toBe('user-1')
  })

  it('fires SIGNED_OUT when a data call returns the expiry marker', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch((url) =>
        url === '/bff/me' ? json(200, { user: USER }) : json(401, { message: 'expired' }, { 'x-gw-session': 'expired' }),
      ),
    )
    const { supabase } = await freshModule()
    const events: string[] = []
    supabase.auth.onAuthStateChange((event: string) => {
      events.push(event)
    })
    await flush()

    await supabase.from('events').select('id')

    expect(events).toEqual(['INITIAL_SESSION', 'SIGNED_OUT'])
  })

  it('does not fire SIGNED_OUT on a plain 401', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch((url) => (url === '/bff/me' ? json(200, { user: USER }) : json(401, { message: 'permission denied' }))),
    )
    const { supabase } = await freshModule()
    const events: string[] = []
    supabase.auth.onAuthStateChange((event: string) => {
      events.push(event)
    })
    await flush()

    await supabase.from('events').select('id')

    expect(events).toEqual(['INITIAL_SESSION'])
  })

  it('reports the admin gate through getHostStatus()', async () => {
    vi.stubGlobal('fetch', routeFetch(() => json(403, { error: 'not_admin', email: 'someone@example.org' })))
    const { getHostStatus } = await freshModule()

    await expect(getHostStatus()).resolves.toEqual({ status: 'not_admin', email: 'someone@example.org' })
  })

  it('keeps nothing in localStorage', async () => {
    window.localStorage.clear()
    vi.stubGlobal('fetch', routeFetch((url) => (url === '/bff/me' ? json(200, { user: USER }) : json(200, []))))
    const { supabase } = await freshModule()

    await supabase.auth.getSession()
    await supabase.from('events').select('id')

    expect(window.localStorage.length).toBe(0)
  })
})

describe('public storage URLs', () => {
  it('host-session: getPublicUrl points at VITE_SUPABASE_PUBLIC_URL, not the admin origin', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'https://project.supabase.co')
    const { supabase } = await freshModule()

    const { data } = supabase.storage.from('media').getPublicUrl('branding/logo.svg')

    expect(data.publicUrl).toBe('https://project.supabase.co/storage/v1/object/public/media/branding/logo.svg')
  })

  it('host-session embedded: rewrites the host proxy prefix too', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'https://project.supabase.co/')
    const mod = await freshModule()
    mod.configureHostSession({
      baseUrl: `${window.location.origin}/api/gatewaze/supabase`,
      anonKey: 'anon-key',
      meUrl: '/me',
      logoutUrl: '/logout',
    })

    const { data } = mod.supabase.storage.from('media').getPublicUrl('a b.png', { download: true })

    expect(data.publicUrl.startsWith('https://project.supabase.co/storage/v1/object/public/media/a%20b.png')).toBe(true)
    expect(data.publicUrl).toContain('download=')
  })

  it('host-session: other storage calls still go through this origin', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'https://project.supabase.co')
    const fetchMock = routeFetch(() => json(200, { signedURL: '/object/sign/media/x?token=t' }))
    vi.stubGlobal('fetch', fetchMock)
    const { supabase } = await freshModule()

    await supabase.storage.from('media').createSignedUrl('x', 60)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url.startsWith(`${window.location.origin}/storage/v1/`)).toBe(true)
  })

  it('local mode: getPublicUrl and the storage client are untouched', async () => {
    vi.stubEnv('VITE_AUTH_MODE', '')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'https://elsewhere.example')
    const { supabase, getSupabase } = await freshModule()

    expect(supabase.storage).toBe((getSupabase() as unknown as { storage: unknown }).storage)
    expect(supabase.storage.from('media').getPublicUrl('x.png').data.publicUrl).toBe(
      'https://project.supabase.co/storage/v1/object/public/media/x.png',
    )
  })
})

describe('public storage URLs with a trailing-slash base', () => {
  it('rewrites when the embed base URL ends in a slash', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLIC_URL', 'https://project.supabase.co')
    const mod = await freshModule()
    mod.configureHostSession({ baseUrl: `${window.location.origin}/proxy/`, anonKey: 'anon-key', meUrl: '/me', logoutUrl: '/logout' })

    const { data } = mod.supabase.storage.from('media').getPublicUrl('x.png')

    expect(data.publicUrl).toBe('https://project.supabase.co/storage/v1/object/public/media/x.png')
  })
})

describe('getHostAdminContext / getHostAdminContextForProfile', () => {
  const ADMIN = {
    profile: {
      id: 'profile-1', user_id: USER.id, email: USER.email, name: 'A', role: 'admin', avatar_url: null,
      is_active: true, created_at: 'c', updated_at: 'u',
    },
    features: ['newsletters'],
  }

  it('return the /me admin context by auth user id and by profile id, and nothing for other ids', async () => {
    vi.stubGlobal('fetch', routeFetch((url) => (url.endsWith('/me') ? json(200, { user: USER, admin: ADMIN }) : json(200, []))))
    const { getHostStatus, getHostAdminContext, getHostAdminContextForProfile } = await freshModule()
    await getHostStatus()

    expect(getHostAdminContext(USER.id)).toEqual(ADMIN)
    expect(getHostAdminContextForProfile('profile-1')).toEqual(ADMIN)
    // Each looks up by its own kind of id only.
    expect(getHostAdminContext('profile-1')).toBeNull()
    expect(getHostAdminContextForProfile(USER.id)).toBeNull()
  })

  it('return nothing in local mode', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'local')
    const fetchMock = routeFetch(() => json(200, { user: USER, admin: ADMIN }))
    vi.stubGlobal('fetch', fetchMock)
    const { getHostAdminContext, getHostAdminContextForProfile } = await freshModule()
    expect(getHostAdminContext(USER.id)).toBeNull()
    expect(getHostAdminContextForProfile('profile-1')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
