'use client'

/**
 * ModuleGuard — renders children only when the user holds the required feature(s). Cosmetic gating
 * for admin controls (buttons, sections) inside the shell; the real boundary is RLS (§13.1).
 */
import type { ReactNode } from 'react'
import { usePortalPermissions } from '@/hooks/usePortalPermissions'

interface ModuleGuardProps {
  /** Single feature required. */
  feature?: string
  /** Any-of features (OR). */
  anyFeature?: string[]
  /** All-of features (AND). */
  allFeatures?: string[]
  children: ReactNode
  /** Rendered when the check fails (default: nothing). */
  fallback?: ReactNode
}

export function ModuleGuard({ feature, anyFeature, allFeatures, children, fallback = null }: ModuleGuardProps) {
  const perms = usePortalPermissions()
  let ok = true
  if (feature) ok = ok && perms.hasFeature(feature)
  if (anyFeature) ok = ok && perms.hasAnyFeature(anyFeature)
  if (allFeatures) ok = ok && perms.hasAllFeatures(allFeatures)
  return <>{ok ? children : fallback}</>
}

export default ModuleGuard
