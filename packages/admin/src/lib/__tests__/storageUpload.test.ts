import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real supabase-js with fetch mocked, so the fallback is checked against
// the requests supabase-js actually makes.
const SUPABASE = 'https://proj.supabase.co'
const R2 = 'https://media.example.com'

type Call = { url: string; init: RequestInit }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    return handler(url, init)
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

async function load() {
  vi.resetModules()
  const supabaseMod = await import('../supabase')
  const getSession = vi.spyOn(supabaseMod.supabase.auth, 'getSession')
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } }, error: null } as never)
  const upload = await import('../storageUpload')
  const pub = await import('../storagePublic')
  return { ...upload, ...pub, supabase: supabaseMod.supabase }
}

function configureR2() {
  vi.stubEnv('VITE_STORAGE_PUBLIC_URL', R2)
  vi.stubEnv('VITE_STORAGE_LEGACY_HOSTS', 'proj.supabase.co,old.b-cdn.net')
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('VITE_API_URL', 'https://api.example.com')
  vi.stubEnv('VITE_STORAGE_PUBLIC_URL', '')
  vi.stubEnv('VITE_STORAGE_LEGACY_HOSTS', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('storage addresses', () => {
  it('keep the Supabase address on a brand without R2', async () => {
    const { publicStorageUrl, rewriteStorageUrl, storageConfig, supabase } = await load()
    expect(storageConfig()).toEqual({ publicUrl: '', legacyHosts: [] })
    expect(publicStorageUrl('media', 'people/a b.png')).toBe(`${SUPABASE}/storage/v1/object/public/media/people/a%20b.png`)
    expect(supabase.storage.from('media').getPublicUrl('x.png', { transform: { width: 100 } }).data.publicUrl).toBe(
      `${SUPABASE}/storage/v1/render/image/public/media/x.png?width=100`,
    )
    const legacy = `${SUPABASE}/storage/v1/object/public/media/x.png`
    expect(rewriteStorageUrl(legacy)).toBe(legacy)
  })

  it('use the R2 address when configured, from the helper and from getPublicUrl', async () => {
    configureR2()
    const { publicStorageUrl, supabase } = await load()
    expect(publicStorageUrl('media', 'people/a b.png')).toBe(`${R2}/people/a%20b.png`)
    expect(publicStorageUrl('speaker-logos', 'l.png')).toBe(`${R2}/speaker-logos/l.png`)
    expect(supabase.storage.from('invite-templates').getPublicUrl('t/1.png').data.publicUrl).toBe(`${R2}/invite-templates/t/1.png`)
    expect(
      supabase.storage.from('media').getPublicUrl('x.png', { transform: { width: 300, height: 200, resize: 'cover' } }).data.publicUrl,
    ).toBe(`${R2}/cdn-cgi/image/width=300,height=200,fit=cover,quality=80,format=auto/x.png`)
  })

  it("rewrite only this brand's legacy hosts", async () => {
    configureR2()
    const { rewriteStorageUrl } = await load()
    expect(rewriteStorageUrl(`${SUPABASE}/storage/v1/object/public/event-images/e.png`)).toBe(`${R2}/event-images/e.png`)
    expect(rewriteStorageUrl('https://old.b-cdn.net/storage/v1/object/public/media/e.png')).toBe(`${R2}/e.png`)
    const aaif = 'https://data.aaif.live/storage/v1/object/public/media/e.png'
    expect(rewriteStorageUrl(aaif)).toBe(aaif)
  })
})

describe('uploadToStorage', () => {
  const file = new Blob(['hello'], { type: 'image/png' })

  it('signs through the API, then PUTs with exactly the returned headers', async () => {
    configureR2()
    const signed = {
      url: 'https://acct.r2.cloudflarestorage.com/bucket/branding/logo.png?X-Amz-Signature=abc',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', 'Content-Length': '5' },
      bucket: 'media',
      path: 'branding/logo.png',
      publicUrl: `${R2}/branding/logo.png`,
    }
    const calls = mockFetch((url) => (url.endsWith('/api/storage/sign-upload') ? json(200, signed) : new Response(null, { status: 200 })))
    const { uploadToStorage } = await load()

    const result = await uploadToStorage('media', 'branding/logo.png', file, { upsert: true })

    expect(result).toEqual({ path: 'branding/logo.png', publicUrl: `${R2}/branding/logo.png` })
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe('https://api.example.com/api/storage/sign-upload')
    expect(calls[0].init.method).toBe('POST')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer jwt-123')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      bucket: 'media',
      path: 'branding/logo.png',
      contentType: 'image/png',
      bytes: 5,
      upsert: true,
    })
    expect(calls[1].url).toBe(signed.url)
    expect(calls[1].init.method).toBe('PUT')
    expect(calls[1].init.headers).toEqual(signed.headers)
    expect(calls[1].init.body).toBe(file)
    expect(calls[1].init.credentials).toBe('omit')
    expect(new Headers(calls[1].init.headers).get('authorization')).toBeNull()
  })

  it('uses the path the server chose', async () => {
    configureR2()
    mockFetch((url) =>
      url.endsWith('/sign-upload')
        ? json(200, { url: 'https://r2.example/put', method: 'PUT', headers: {}, bucket: 'media', path: 'speaker-submissions/uuid-me.png', publicUrl: `${R2}/speaker-submissions/uuid-me.png` })
        : new Response(null, { status: 200 }),
    )
    const { uploadToStorage } = await load()
    const result = await uploadToStorage('media', 'speaker-submissions/me.png', file)
    expect(result.path).toBe('speaker-submissions/uuid-me.png')
  })

  it('falls back to supabase-js when the API says not_enabled', async () => {
    configureR2()
    const calls = mockFetch((url) =>
      url.endsWith('/sign-upload') ? json(404, { error: 'not_enabled' }) : json(200, { Key: 'media/branding/logo.png', Id: '1' }),
    )
    const { uploadToStorage } = await load()
    const result = await uploadToStorage('media', 'branding/logo.png', file, { upsert: true })
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe(`${SUPABASE}/storage/v1/object/media/branding/logo.png`)
    expect(calls[1].init.method).toBe('POST')
    expect(result.path).toBe('branding/logo.png')
  })

  it('goes straight to supabase-js on a brand without R2', async () => {
    const calls = mockFetch(() => json(200, { Key: 'media/blog-posts/a.png', Id: '1' }))
    const { uploadToStorage } = await load()
    const result = await uploadToStorage('media', 'blog-posts/a.png', file, { upsert: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${SUPABASE}/storage/v1/object/media/blog-posts/a.png`)
    expect(result).toEqual({ path: 'blog-posts/a.png', publicUrl: `${SUPABASE}/storage/v1/object/public/media/blog-posts/a.png` })
  })

  it('throws a readable error on a conflict and on a failed PUT', async () => {
    configureR2()
    mockFetch(() => json(409, { error: 'exists' }))
    let mod = await load()
    await expect(mod.uploadToStorage('media', 'a.png', file)).rejects.toThrow('A file with that name already exists')

    mockFetch((url) =>
      url.endsWith('/sign-upload')
        ? json(200, { url: 'https://r2.example/put', method: 'PUT', headers: {}, bucket: 'media', path: 'a.png', publicUrl: `${R2}/a.png` })
        : new Response('denied', { status: 403 }),
    )
    mod = await load()
    await expect(mod.uploadToStorage('media', 'a.png', file)).rejects.toThrow('Upload failed (403)')
  })
})

describe('uploadToStorage hardening', () => {
  const file = new Blob(['x'], { type: 'image/png' })
  const sign = (over: Record<string, unknown>) => ({ url: 'https://r2.example/put', method: 'PUT', headers: {}, bucket: 'media', path: 'a.png', publicUrl: `${R2}/a.png`, ...over })

  it('refuses a non-https upload address and strips credentials from the signed headers', async () => {
    configureR2()
    mockFetch(() => json(200, sign({ url: 'http://r2.example/put' })))
    let mod = await load()
    await expect(mod.uploadToStorage('media', 'a.png', file)).rejects.toThrow('bad upload address')

    const calls = mockFetch((url) =>
      url.endsWith('/sign-upload') ? json(200, sign({ headers: { 'Content-Type': 'image/png', Authorization: 'Bearer leak', Cookie: 'c=1' } })) : new Response(null, { status: 200 }),
    )
    mod = await load()
    await mod.uploadToStorage('media', 'a.png', file)
    expect(calls[1].init.headers).toEqual({ 'Content-Type': 'image/png' })
  })
})

describe('removeFromStorage', () => {
  it('deletes through the API and reports failures', async () => {
    configureR2()
    const calls = mockFetch(() => json(200, { failed: [] }))
    let mod = await load()
    await mod.removeFromStorage('media', ['a.png'])
    expect(calls[0].url).toBe('https://api.example.com/api/storage/delete')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ bucket: 'media', paths: ['a.png'] })

    mockFetch(() => json(200, { failed: ['a.png'] }))
    mod = await load()
    await expect(mod.removeFromStorage('media', ['a.png'])).rejects.toThrow('Could not delete a.png')
  })

  it('falls back to supabase-js when not enabled or not configured', async () => {
    configureR2()
    let calls = mockFetch((url) => (url.endsWith('/api/storage/delete') ? json(404, { error: 'not_enabled' }) : json(200, [])))
    let mod = await load()
    await mod.removeFromStorage('media', ['a.png'])
    expect(calls[1].url).toBe(`${SUPABASE}/storage/v1/object/media`)
    expect(calls[1].init.method).toBe('DELETE')

    vi.stubEnv('VITE_STORAGE_PUBLIC_URL', '')
    calls = mockFetch(() => json(200, []))
    mod = await load()
    await mod.removeFromStorage('media', ['a.png'])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${SUPABASE}/storage/v1/object/media`)
  })
})
