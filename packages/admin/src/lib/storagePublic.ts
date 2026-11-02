/**
 * Public addresses for the brand's stored files.
 *
 * A brand that moved off Supabase Storage sets VITE_STORAGE_PUBLIC_URL (its
 * R2 origin) and VITE_STORAGE_LEGACY_HOSTS (the hosts its old addresses
 * used). A brand without them keeps its Supabase addresses exactly as before.
 */
import {
  rewriteStorageUrl as rewriteWith,
  storagePublicUrl as publicUrlWith,
} from '@gatewaze/shared'

import { storageConfig } from './storageConfig'
import { supabase } from './supabase'

export { storageConfig }

/** The public address of `path` in `bucket`. */
export function publicStorageUrl(bucket: string, path: string): string {
  const r2 = publicUrlWith(storageConfig(), bucket, path)
  if (r2) return r2
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

/**
 * Turns one of this brand's old Supabase addresses into its R2 address.
 * Anything else, and every address on a brand without the setting, comes
 * back unchanged.
 */
export function rewriteStorageUrl(url: string): string {
  return rewriteWith(url, storageConfig())
}
