import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { resolveStoragePublic } from '../storagePublicEnv'

const SUPABASE = 'https://proj.supabase.co'
const R2 = 'https://media.example.com'

function setBrandConfig(extra: Record<string, unknown>) {
  document.getElementById('__brand_config__')?.remove()
  const el = document.createElement('script')
  el.id = '__brand_config__'
  el.type = 'application/json'
  el.textContent = JSON.stringify({ id: 'b', supabaseUrl: SUPABASE, supabaseAnonKey: 'anon', storageBucketUrl: '', ...extra })
  document.head.appendChild(el)
}

const R2_BRAND = { storagePublicUrl: R2, storageLegacyHosts: ['proj.supabase.co', 'old.b-cdn.net'] }

async function load() {
  vi.resetModules()
  return {
    pub: await import('../storagePublic'),
    card: await import('../cardImage'),
    bunny: await import('../bunnyNet'),
    agenda: await import('../agendaTalkSurface'),
    resolve: await import('../storage-resolve'),
  }
}

afterEach(() => {
  document.getElementById('__brand_config__')?.remove()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('resolveStoragePublic', () => {
  it('prefers the server names, falls back to NEXT_PUBLIC_, and drops bad values', () => {
    expect(resolveStoragePublic({ STORAGE_PUBLIC_URL: `${R2}/`, STORAGE_LEGACY_HOSTS: 'A.supabase.co, bad host' })).toEqual({
      publicUrl: R2,
      legacyHosts: ['a.supabase.co'],
    })
    expect(resolveStoragePublic({ NEXT_PUBLIC_STORAGE_PUBLIC_URL: R2 }).publicUrl).toBe(R2)
    expect(resolveStoragePublic({ STORAGE_PUBLIC_URL: 'http://media.example.com' }).publicUrl).toBe('')
    expect(resolveStoragePublic({ STORAGE_PUBLIC_URL: 'javascript:alert(1)' }).publicUrl).toBe('')
    expect(resolveStoragePublic({})).toEqual({ publicUrl: '', legacyHosts: [] })
  })
})

describe('a brand without R2 (AAIF)', () => {
  beforeEach(() => setBrandConfig({}))

  it('builds the same address supabase-js does and rewrites nothing', async () => {
    const { pub } = await load()
    const client = createClient(SUPABASE, 'anon')
    for (const path of ['people/a b.png', '/event-previews/x.jpg']) {
      expect(pub.publicStorageUrl('media', path)).toBe(client.storage.from('media').getPublicUrl(path).data.publicUrl)
    }
    expect(pub.r2StorageUrl('speaker-logos', 'l.png')).toBeNull()
    const legacy = `${SUPABASE}/storage/v1/object/public/media/x.png`
    expect(pub.rewriteStorageUrl(legacy)).toBe(legacy)
    expect(pub.withStoragePublicUrls(client)).toBe(client)
    expect(client.storage.from('media').getPublicUrl('x.png').data.publicUrl).toBe(legacy)
  })

  it('leaves card images, Bunny and agenda photos on their old paths', async () => {
    const { card, bunny, agenda } = await load()
    const preview = `${SUPABASE}/storage/v1/object/public/media/event-previews/e.jpg`
    expect(card.cardImage(preview).src).toBe(`${SUPABASE}/storage/v1/render/image/public/media/event-previews/e.jpg?width=640&height=336&resize=cover`)
    expect(bunny.getBunnyImageUrl(preview, { width: 100 })).toBe(preview)
    expect(agenda.talkPhotoUrl(SUPABASE, 'media', 'p/1.jpg')).toBe(`${SUPABASE}/storage/v1/object/public/media/p/1.jpg`)
  })
})

describe('a brand on R2', () => {
  beforeEach(() => setBrandConfig(R2_BRAND))

  it('gives R2 addresses from the helper and from wrapped getPublicUrl', async () => {
    const { pub } = await load()
    expect(pub.publicStorageUrl('media', 'people/a b.png')).toBe(`${R2}/people/a%20b.png`)
    expect(pub.publicStorageUrl('speaker-logos', 'l.png')).toBe(`${R2}/speaker-logos/l.png`)
    const client = pub.withStoragePublicUrls(createClient(SUPABASE, 'anon'))
    expect(client.storage.from('media').getPublicUrl('p/x.png').data.publicUrl).toBe(`${R2}/p/x.png`)
    expect(client.storage.from('event-images').getPublicUrl('x.png').data.publicUrl).toBe(`${R2}/event-images/x.png`)
    expect(client.storage.from('media').getPublicUrl('x.png', { transform: { width: 200, resize: 'cover' } }).data.publicUrl).toBe(
      `${R2}/cdn-cgi/image/width=200,fit=cover,quality=80,format=auto/x.png`,
    )
  })

  it("rewrites only this brand's hosts", async () => {
    const { pub } = await load()
    expect(pub.rewriteStorageUrl(`${SUPABASE}/storage/v1/object/public/media/x.png`)).toBe(`${R2}/x.png`)
    expect(pub.rewriteStorageUrl('https://old.b-cdn.net/storage/v1/object/public/blog-images/x.png')).toBe(`${R2}/blog-images/x.png`)
    const aaif = 'https://data.aaif.live/storage/v1/object/public/media/x.png'
    expect(pub.rewriteStorageUrl(aaif)).toBe(aaif)
    expect(pub.storageKeyOf('https://media.example.com.evil.test/x.png')).toBeNull()
    expect(pub.storageKeyOf(`${R2}/cdn-cgi/image/width=1/x.png`)).toBeNull()
    // The URL parser resolves encoded dot segments before the key is read.
    expect(pub.storageKeyOf(`${R2}/event-previews/%2e%2e/x.png`)).toBe('x.png')
    expect(pub.storageKeyOf(`${R2}/event-previews/a%20b.png`)).toBe('event-previews/a b.png')
  })

  it('resizes card previews through Cloudflare and leaves other images plain', async () => {
    const { card } = await load()
    const legacyPreview = `${SUPABASE}/storage/v1/object/public/media/event-previews/e.jpg`
    const img = card.cardImage(legacyPreview, 'https://zone.b-cdn.net')
    expect(img.src).toBe(`${R2}/cdn-cgi/image/width=640,height=336,fit=cover,quality=85,format=auto/event-previews/e.jpg`)
    expect(img.srcSet).toContain(`${R2}/cdn-cgi/image/width=360,height=189,fit=cover,quality=85,format=auto/event-previews/e.jpg 360w`)
    expect(img.width).toBe(640)
    expect(card.cardImage(`${SUPABASE}/storage/v1/object/public/media/event-logos/l.png`)).toEqual({ src: `${R2}/event-logos/l.png` })
    const other = 'https://data.aaif.live/storage/v1/object/public/media/event-logos/l.png'
    expect(card.cardImage(other)).toEqual({ src: other })
  })

  it('moves Bunny resizes, agenda photos and event images to R2', async () => {
    const { bunny, agenda, resolve } = await load()
    expect(bunny.getBunnyImageUrl(`${SUPABASE}/storage/v1/object/public/media/g/1.jpg`, { width: 400, quality: 80, fit: 'cover' })).toBe(
      `${R2}/cdn-cgi/image/width=400,fit=cover,quality=80,format=auto/g/1.jpg`,
    )
    expect(bunny.getBunnyImageUrl('https://elsewhere.example/x.jpg', { width: 400 })).toBe('https://elsewhere.example/x.jpg')
    expect(agenda.talkPhotoUrl(SUPABASE, 'event-media', 'p/1.jpg')).toBe(
      `${R2}/cdn-cgi/image/width=400,fit=cover,quality=80,format=auto/event-media/p/1.jpg`,
    )
    const event = { event_logo: `${SUPABASE}/storage/v1/object/public/media/event-logos/l.png`, screenshot_url: 'event-previews/s.jpg' }
    expect(resolve.resolveEventImages(event, R2)).toEqual({ event_logo: `${R2}/event-logos/l.png`, screenshot_url: `${R2}/event-previews/s.jpg` })
  })
})
