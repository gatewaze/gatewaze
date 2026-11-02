import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE = 'https://proj.supabase.co'
const R2 = 'https://media.example.com'

let client: SupabaseClient | null = null
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => (client ??= createClient(SUPABASE, 'anon', { auth: { persistSession: false } })),
}))

type Call = { url: string; init: RequestInit }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, init })
      return handler(url, init)
    }),
  )
  return calls
}

function setBrandConfig(extra: Record<string, unknown>) {
  document.getElementById('__brand_config__')?.remove()
  const el = document.createElement('script')
  el.id = '__brand_config__'
  el.type = 'application/json'
  el.textContent = JSON.stringify({ id: 'b', supabaseUrl: SUPABASE, supabaseAnonKey: 'anon', ...extra })
  document.head.appendChild(el)
}

async function load() {
  vi.resetModules()
  client = null
  return import('../storageUpload')
}

const file = new Blob(['hello'], { type: 'image/jpeg' })

beforeEach(() => setBrandConfig({ storagePublicUrl: R2, storageLegacyHosts: ['proj.supabase.co'] }))

afterEach(() => {
  document.getElementById('__brand_config__')?.remove()
  vi.unstubAllGlobals()
})

describe('uploadToStorage (portal)', () => {
  it('signs on the same origin, PUTs with the returned headers, and keeps the server-chosen path', async () => {
    const signed = {
      url: 'https://acct.r2.cloudflarestorage.com/b/speaker-submissions/uuid-me.jpg?X-Amz-Signature=s',
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      bucket: 'media',
      path: 'speaker-submissions/uuid-me.jpg',
      publicUrl: `${R2}/speaker-submissions/uuid-me.jpg`,
    }
    const calls = mockFetch((url) => (url === '/api/storage/sign-upload' ? json(200, signed) : new Response(null, { status: 200 })))
    const { uploadToStorage } = await load()

    const result = await uploadToStorage('media', 'speaker-submissions/1-abc.jpg', file, { contentType: 'image/jpeg', upsert: false })

    expect(result).toEqual({ path: signed.path, publicUrl: signed.publicUrl })
    expect(calls[0].url).toBe('/api/storage/sign-upload')
    // Anonymous visitor: no token to send.
    expect(new Headers(calls[0].init.headers).get('authorization')).toBeNull()
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      bucket: 'media',
      path: 'speaker-submissions/1-abc.jpg',
      contentType: 'image/jpeg',
      bytes: 5,
      upsert: false,
    })
    expect(calls[1]).toEqual({ url: signed.url, init: { method: 'PUT', headers: signed.headers, body: file, credentials: 'omit', redirect: 'error' } })
  })

  it('falls back to supabase-js on 404 not_enabled', async () => {
    const calls = mockFetch((url) => (url === '/api/storage/sign-upload' ? json(404, { error: 'not_enabled' }) : json(200, { Key: 'media/profiles/p.jpg' })))
    const { uploadToStorage } = await load()
    const result = await uploadToStorage('media', 'profiles/p.jpg', file)
    expect(calls[1].url).toBe(`${SUPABASE}/storage/v1/object/media/profiles/p.jpg`)
    expect(result.path).toBe('profiles/p.jpg')
  })

  it('uses supabase-js directly on a brand without R2', async () => {
    setBrandConfig({})
    const calls = mockFetch(() => json(200, { Key: 'media/talks/t.pdf' }))
    const { uploadToStorage } = await load()
    const result = await uploadToStorage('media', 'talks/t.pdf', file, { contentType: 'application/pdf', upsert: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${SUPABASE}/storage/v1/object/media/talks/t.pdf`)
    expect(result).toEqual({ path: 'talks/t.pdf', publicUrl: `${SUPABASE}/storage/v1/object/public/media/talks/t.pdf` })
  })

  it('reports rate limiting and failed PUTs readably', async () => {
    mockFetch(() => json(429, { error: 'rate_limited' }))
    let mod = await load()
    await expect(mod.uploadToStorage('media', 'speaker-submissions/a.jpg', file)).rejects.toThrow(/Too many uploads/)

    mockFetch((url) =>
      url === '/api/storage/sign-upload'
        ? json(200, { url: 'https://r2.example/put', method: 'PUT', headers: {}, bucket: 'media', path: 'a.jpg', publicUrl: `${R2}/a.jpg` })
        : new Response(null, { status: 403 }),
    )
    mod = await load()
    await expect(mod.uploadToStorage('media', 'a.jpg', file)).rejects.toThrow('Upload failed (403)')
  })
})

describe('removeFromStorage (portal)', () => {
  it('deletes through the API, and through supabase-js when not enabled', async () => {
    let calls = mockFetch(() => json(200, { failed: [] }))
    let mod = await load()
    await mod.removeFromStorage('media', ['a.jpg'])
    expect(calls[0].url).toBe('/api/storage/delete')

    calls = mockFetch((url) => (url === '/api/storage/delete' ? json(404, { error: 'not_enabled' }) : json(200, [])))
    mod = await load()
    await mod.removeFromStorage('media', ['a.jpg'])
    expect(calls[1].url).toBe(`${SUPABASE}/storage/v1/object/media`)
  })
})
