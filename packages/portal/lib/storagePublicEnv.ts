/**
 * Reads the brand's storage settings from an env object. Server code passes
 * process.env: STORAGE_PUBLIC_URL / STORAGE_LEGACY_HOSTS first, then the
 * NEXT_PUBLIC_ spellings that module code without a brand config reads.
 * Invalid values are dropped (see storagePublicConfig): only a plain https
 * origin and plain hostnames are ever used.
 *
 * No imports from config/brand.ts, so the brand config can use it.
 */
import { storagePublicConfig, type StoragePublicConfig } from '@gatewaze/shared'

type EnvLike = Record<string, string | undefined>

export function resolveStoragePublic(env: EnvLike): StoragePublicConfig {
  const server = storagePublicConfig(env)
  if (server.publicUrl) return server
  return storagePublicConfig(env, 'NEXT_PUBLIC_')
}
