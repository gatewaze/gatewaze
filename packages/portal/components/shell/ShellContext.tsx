'use client'

/**
 * ShellContext — client context shared across the workspace shell. Carries the access map + active
 * module, lets dynamic pages publish a breadcrumb leaf (`<SetBreadcrumb>`) or override the
 * contextual sidebar nav (e.g. a newsletter detail page). Spec §3.3 / §7.1.
 */
import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import type { ModuleAccessMap } from '@/lib/modules/access'
import type { PortalShellNavEntry } from '@gatewaze/shared'

interface ShellContextValue {
  access: ModuleAccessMap
  activeModuleId: string | null
  breadcrumbLeaf: string | null
  setBreadcrumbLeaf: (leaf: string | null) => void
  navOverride: PortalShellNavEntry[] | null
  setNavOverride: (nav: PortalShellNavEntry[] | null) => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

export function ShellProvider({
  access,
  activeModuleId,
  children,
}: {
  access: ModuleAccessMap
  activeModuleId: string | null
  children: React.ReactNode
}) {
  const [breadcrumbLeaf, setBreadcrumbLeaf] = useState<string | null>(null)
  const [navOverride, setNavOverride] = useState<PortalShellNavEntry[] | null>(null)

  // Reset page-published state whenever the active module changes.
  useEffect(() => {
    setBreadcrumbLeaf(null)
    setNavOverride(null)
  }, [activeModuleId])

  const value = useMemo<ShellContextValue>(
    () => ({ access, activeModuleId, breadcrumbLeaf, setBreadcrumbLeaf, navOverride, setNavOverride }),
    [access, activeModuleId, breadcrumbLeaf, navOverride],
  )
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used within ShellProvider')
  return ctx
}

/** Page-level helper: publish the breadcrumb leaf (e.g. an entity title). Renders nothing. */
export function SetBreadcrumb({ title }: { title: string }) {
  const { setBreadcrumbLeaf } = useShell()
  useEffect(() => {
    setBreadcrumbLeaf(title)
    return () => setBreadcrumbLeaf(null)
  }, [title, setBreadcrumbLeaf])
  return null
}

/** Page-level helper: override the contextual sidebar nav (e.g. per-newsletter sub-nav). */
export function SetSidebarNav({ nav }: { nav: PortalShellNavEntry[] }) {
  const { setNavOverride } = useShell()
  useEffect(() => {
    setNavOverride(nav)
    return () => setNavOverride(null)
  }, [nav, setNavOverride])
  return null
}
