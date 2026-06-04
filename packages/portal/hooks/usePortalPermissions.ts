'use client'

/**
 * usePortalPermissions — client-side feature checks for cosmetic gating inside the workspace shell
 * (e.g. hide a "New edition" button). Reads the server-computed grants from ShellContext (no client
 * RPC round-trip, no access flash). Super-admins short-circuit to true. Spec §9.2 / §3.3.
 *
 * This is cosmetic only — the authoritative control is server-side RLS (§13.1). Never rely on it
 * for security.
 */
import { useMemo } from 'react'
import { useShell } from '@/components/shell/ShellContext'

export interface PortalPermissions {
  isSuperAdmin: boolean
  featureKeys: string[]
  hasFeature: (feature: string) => boolean
  hasAnyFeature: (features: string[]) => boolean
  hasAllFeatures: (features: string[]) => boolean
}

export function usePortalPermissions(): PortalPermissions {
  const { featureKeys, isSuperAdmin } = useShell()
  return useMemo<PortalPermissions>(() => {
    const set = new Set(featureKeys)
    const hasFeature = (f: string) => isSuperAdmin || set.has(f)
    return {
      isSuperAdmin,
      featureKeys,
      hasFeature,
      hasAnyFeature: (fs) => isSuperAdmin || fs.some((f) => set.has(f)),
      hasAllFeatures: (fs) => isSuperAdmin || fs.every((f) => set.has(f)),
    }
  }, [featureKeys, isSuperAdmin])
}
