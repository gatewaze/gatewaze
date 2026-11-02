/**
 * Public addresses for the brand's stored files, in server and browser code.
 *
 * A brand that moved off Supabase Storage has `storagePublicUrl` and
 * `storageLegacyHosts` in its brand config (from STORAGE_PUBLIC_URL and
 * STORAGE_LEGACY_HOSTS on the server). Every other brand keeps its Supabase
 * addresses exactly as before.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  rewriteStorageUrl as rewriteWith,
  storagePublicConfig,
  storagePublicUrl as publicUrlWith,
  storageSizedUrl,
  type PublicSize,
  type StoragePublicConfig,
} from '@gatewaze/shared'

import { getClientBrandConfig } from '@/config/brand'
import { resolveStoragePublic } from '@/lib/storagePublicEnv'

let clientConfig: StoragePublicConfig | null = null

/**
 * The brand's storage settings. On the server they come from process.env on
 * every call; in the browser from the brand config the layout injected (read
 * once per page), or the build-time NEXT_PUBLIC_ values when there is none.
 */
export function storageConfig(): StoragePublicConfig {
  if (typeof window === 'undefined') return resolveStoragePublic(process.env)
  if (clientConfig) return clientConfig
  const brand = getClientBrandConfig()
  clientConfig = brand.storagePublicUrl
    ? storagePublicConfig({
        STORAGE_PUBLIC_URL: brand.storagePublicUrl,
        STORAGE_LEGACY_HOSTS: (brand.storageLegacyHosts ?? []).join(','),
      })
    : storagePublicConfig({
        // Written out in full so Next inlines them into the browser bundle.
        STORAGE_PUBLIC_URL: process.env.NEXT_PUBLIC_STORAGE_PUBLIC_URL,
        STORAGE_LEGACY_HOSTS: process.env.NEXT_PUBLIC_STORAGE_LEGACY_HOSTS,
      })
  return clientConfig
}

function supabasePublicBase(): string {
  const base =
    typeof window === 'undefined'
      ? process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
      : getClientBrandConfig().supabaseUrl || ''
  return base.replace(/\/+$/, '')
}

/**
 * The public address of `path` in `bucket`: the R2 address when configured,
 * otherwise the same Supabase address supabase-js getPublicUrl() gives.
 */
export function publicStorageUrl(bucket: string, path: string): string {
  const r2 = publicUrlWith(storageConfig(), bucket, path)
  if (r2) return r2
  return encodeURI(`${supabasePublicBase()}/storage/v1/object/public/${bucket}/${path.replace(/^\/+/, '')}`)
}

/**
 * The R2 address of `path` in `bucket`, or null on a brand without R2 (the
 * caller then keeps the address it builds today).
 */
export function r2StorageUrl(bucket: string, path: string): string | null {
  return publicUrlWith(storageConfig(), bucket, path)
}

/**
 * Turns one of this brand's old Supabase addresses into its R2 address.
 * Anything else, and every address on a brand without R2, comes back unchanged.
 */
export function rewriteStorageUrl(url: string): string {
  return rewriteWith(url, storageConfig())
}

/**
 * The key of a file on this brand's R2 origin, decoded, or null when `url`
 * is not a plain file address there (another host, a resize address, or a
 * brand without R2). Legacy addresses are rewritten first.
 */
export function storageKeyOf(url: string): string | null {
  const cfg = storageConfig()
  if (!cfg.publicUrl || !url) return null
  let u: URL
  try {
    u = new URL(rewriteWith(url, cfg))
  } catch {
    return null
  }
  if (u.origin !== cfg.publicUrl || u.search || u.hash) return null
  const key = u.pathname.replace(/^\/+/, '')
  if (!key || key.startsWith('cdn-cgi/')) return null
  let segments: string[]
  try {
    segments = key.split('/').map(decodeURIComponent)
  } catch {
    return null
  }
  // An encoded dot segment would climb out of the resize prefix once re-emitted.
  if (segments.some((s) => s === '.' || s === '..' || s === '')) return null
  return segments.join('/')
}

/**
 * A resized copy of one of this brand's files through Cloudflare, or null
 * when the brand has no R2 or `url` is not one of its files.
 */
export function resizedStorageUrl(url: string, size: PublicSize): string | null {
  const key = storageKeyOf(url)
  if (key === null) return null
  // The key already carries any bucket prefix, so it is addressed as `media`.
  return storageSizedUrl(storageConfig(), 'media', key, size)
}

type StorageFileApi = ReturnType<SupabaseClient['storage']['from']>
type GetPublicUrlArgs = Parameters<StorageFileApi['getPublicUrl']>

function r2Address(bucket: string, [path, options]: GetPublicUrlArgs): string | null {
  const cfg = storageConfig()
  if (!cfg.publicUrl || typeof path !== 'string') return null
  const t = options?.transform
  if (t?.width) {
    return storageSizedUrl(cfg, bucket, path, {
      width: t.width,
      height: t.height,
      fit: t.resize === 'cover' ? 'cover' : 'contain',
      quality: t.quality,
    })
  }
  return publicUrlWith(cfg, bucket, path)
}

/**
 * Makes `client.storage.from(bucket).getPublicUrl()` hand out the R2 address
 * on a brand that has one. Nothing else on the client changes, and a brand
 * without R2 gets its client back untouched.
 */
export function withStoragePublicUrls<T extends SupabaseClient>(client: T): T {
  if (!storageConfig().publicUrl) return client
  const storage = client.storage
  const from = storage.from.bind(storage)
  storage.from = ((bucket: string) => {
    const api = from(bucket)
    const getPublicUrl = api.getPublicUrl.bind(api)
    api.getPublicUrl = ((...args: GetPublicUrlArgs) => {
      const result = getPublicUrl(...args)
      const publicUrl = r2Address(bucket, args)
      return publicUrl ? { ...result, data: { ...result.data, publicUrl } } : result
    }) as StorageFileApi['getPublicUrl']
    return api
  }) as typeof storage.from
  return client
}
