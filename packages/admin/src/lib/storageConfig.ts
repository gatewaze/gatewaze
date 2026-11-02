import { storagePublicConfig, type StoragePublicConfig } from '@gatewaze/shared'

/**
 * The brand's storage addresses, from the runtime config. Both names are
 * written out in full because the build only rewrites the
 * `import.meta.env.VITE_*` names it finds literally in the source
 * (vite-shared-config.ts buildRuntimeConfigDefine). Read at call time
 * because an embed sets the runtime config at mount, after this module is
 * evaluated.
 *
 * Kept apart from storagePublic.ts so lib/supabase.ts can read it without
 * importing a module that imports it back.
 */
export function storageConfig(): StoragePublicConfig {
  return storagePublicConfig(
    {
      VITE_STORAGE_PUBLIC_URL: import.meta.env.VITE_STORAGE_PUBLIC_URL,
      VITE_STORAGE_LEGACY_HOSTS: import.meta.env.VITE_STORAGE_LEGACY_HOSTS,
    },
    'VITE_',
  )
}
