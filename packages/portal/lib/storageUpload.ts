/**
 * Browser uploads to the brand's storage.
 *
 * On a brand with R2 the API signs a one-off PUT (POST /api/storage/sign-upload,
 * reached through the portal's same-origin rewrite) and the file goes straight
 * to the bucket. On a brand without it, or when the API says the route is not
 * enabled, the upload goes through supabase-js exactly as before.
 */
import { getSupabaseClient } from '@/lib/supabase/client'
import { storageConfig } from '@/lib/storagePublic'

export interface UploadOptions {
  upsert?: boolean
  contentType?: string
}

export interface UploadResult {
  path: string
  publicUrl: string
}

interface SignedUpload {
  url: string
  method: 'PUT'
  headers: Record<string, string>
  bucket: string
  path: string
  publicUrl: string
}

const NOT_ENABLED = Symbol('not_enabled')

/** Never let credentials ride the PUT to the bucket, whatever the API sent. */
const NEVER_FORWARD = new Set(['authorization', 'cookie', 'proxy-authorization'])

function putRequest(signed: SignedUpload, file: Blob): { url: string; init: RequestInit } {
  let url: URL
  try {
    url = new URL(signed.url)
  } catch {
    throw new Error('Upload failed: bad upload address')
  }
  if (url.protocol !== 'https:') throw new Error('Upload failed: bad upload address')
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(signed.headers ?? {})) {
    if (!NEVER_FORWARD.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
  }
  return { url: url.href, init: { method: 'PUT', headers, body: file, credentials: 'omit', redirect: 'error' } }
}

async function authHeaders(): Promise<Headers> {
  // Same origin only (the /api/storage rewrite), so the token never leaves it.
  // Anonymous visitors (public speaker submissions) send none.
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const { data } = await getSupabaseClient().auth.getSession()
  const token = data.session?.access_token
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

async function readError(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null
  if (body && typeof body.error === 'string') return body.error
  if (body && body.error && typeof body.error === 'object' && typeof (body.error as { message?: unknown }).message === 'string') {
    return (body.error as { message: string }).message
  }
  if (body && typeof body.message === 'string') return body.message
  return null
}

async function postStorage<T>(route: 'sign-upload' | 'delete', body: unknown): Promise<T | typeof NOT_ENABLED> {
  const res = await fetch(`/api/storage/${route}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  })
  if (res.ok) return (await res.json()) as T
  const error = await readError(res)
  if (res.status === 404 && error === 'not_enabled') return NOT_ENABLED
  if (res.status === 409 && error === 'exists') throw new Error('A file with that name already exists')
  if (res.status === 429) throw new Error('Too many uploads. Please wait a moment and try again.')
  throw new Error(error ? `Storage ${route} failed: ${error}` : `Storage ${route} failed (${res.status})`)
}

async function supabaseUpload(bucket: string, path: string, file: Blob, opts: UploadOptions): Promise<UploadResult> {
  const supabase = getSupabaseClient()
  const options: { upsert?: boolean; contentType?: string } = {}
  if (opts.upsert !== undefined) options.upsert = opts.upsert
  if (opts.contentType !== undefined) options.contentType = opts.contentType
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, options)
  if (error) throw new Error(error.message || 'Upload failed')
  const stored = data?.path ?? path
  return { path: stored, publicUrl: supabase.storage.from(bucket).getPublicUrl(stored).data.publicUrl }
}

/** Browsers often give fonts (and some other files) no type; work it out from the name. */
const TYPES_BY_EXTENSION: Record<string, string> = {
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
}

function typeFromName(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  return TYPES_BY_EXTENSION[ext] ?? ''
}

/**
 * Uploads `file` to `bucket` at `path` and returns where it ended up. Always
 * use the returned `path` and `publicUrl`: for public speaker uploads
 * (`speaker-submissions/`, `talks/`) the server picks the final name.
 */
export async function uploadToStorage(bucket: string, path: string, file: Blob, opts: UploadOptions = {}): Promise<UploadResult> {
  if (!storageConfig().publicUrl) return supabaseUpload(bucket, path, file, opts)

  const contentType = opts.contentType || file.type || typeFromName(path) || 'application/octet-stream'
  const signed = await postStorage<SignedUpload>('sign-upload', {
    bucket,
    path,
    contentType,
    bytes: file.size,
    ...(opts.upsert !== undefined ? { upsert: opts.upsert } : {}),
  })
  if (signed === NOT_ENABLED) return supabaseUpload(bucket, path, file, opts)

  // Only the headers the signature covers; never our own Authorization,
  // which must not leave the API origin.
  const req = putRequest(signed, file)
  const put = await fetch(req.url, req.init)
  if (!put.ok) throw new Error(`Upload failed (${put.status})`)
  return { path: signed.path, publicUrl: signed.publicUrl }
}

/** Deletes `paths` from `bucket`. Throws when any of them could not be deleted. */
export async function removeFromStorage(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  if (storageConfig().publicUrl) {
    const result = await postStorage<{ failed?: string[] }>('delete', { bucket, paths })
    if (result !== NOT_ENABLED) {
      const failed = result.failed ?? []
      if (failed.length > 0) throw new Error(`Could not delete ${failed.join(', ')}`)
      return
    }
  }
  const { error } = await getSupabaseClient().storage.from(bucket).remove(paths)
  if (error) throw new Error(error.message || 'Delete failed')
}
