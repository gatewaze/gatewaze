'use client'

/**
 * WorkspaceShell — the client shell layered into the (main) server layout. Renders the rail +
 * contextual sidebar + full-width header around `{children}`, deriving the active module + active
 * state from the URL (the URL is the source of truth, not internal state). Chromeless paths render
 * bare; `gated` modules render the SignInGate; `fullBleed` modules suppress the sidebar.
 * Spec §3.1 / §7.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { RailItem } from '@/lib/modules/enabledModules'
import type { ModuleAccessMap } from '@/lib/modules/access'
import type { PortalShellNavEntry, PortalShellNavItem } from '@gatewaze/shared'
import { ShellProvider } from './ShellContext'
import { ModuleRail } from './ModuleRail'
import { ContextualSidebar } from './ContextualSidebar'
import { ShellHeader } from './ShellHeader'
import { ShellErrorBoundary } from './ShellErrorBoundary'
import { SignInGate } from './SignInGate'

/** Paths that render without shell chrome (full-bleed auth screens). */
const CHROMELESS_PATHS = ['/sign-in', '/auth/callback']

interface WorkspaceShellProps {
  railItems: RailItem[]
  access: ModuleAccessMap
  featureKeys: string[]
  isSuperAdmin: boolean
  brandName: string
  logoIconUrl?: string
  children: React.ReactNode
}

/** Derive the active module id from the pathname (admin segment, /m/<id>, or rail-href prefix). */
function deriveActiveModuleId(pathname: string, items: RailItem[]): string | null {
  if (pathname === '/') return 'home'
  if (pathname.startsWith('/admin/')) {
    return pathname.split('/')[2] || null
  }
  if (pathname.startsWith('/m/')) {
    return pathname.split('/')[2] || null
  }
  // Longest public-href prefix wins (so '/events/...' maps to the events rail item).
  let best: { id: string; len: number } | null = null
  for (const it of items) {
    const base = it.href.split('?')[0]
    if (base && base !== '/' && (pathname === base || pathname.startsWith(base + '/') || pathname.startsWith(base))) {
      if (!best || base.length > best.len) best = { id: it.moduleId, len: base.length }
    }
  }
  return best?.id ?? null
}

function isNavItem(e: PortalShellNavEntry): e is PortalShellNavItem {
  return (e as { section?: string }).section === undefined
}

export function WorkspaceShell({
  railItems,
  access,
  featureKeys,
  isSuperAdmin,
  brandName,
  logoIconUrl,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname() || '/'
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Restore the collapse preference after mount (avoids SSR/CSR mismatch).
  useEffect(() => {
    if (typeof window === 'undefined') return
    setSideCollapsed(window.localStorage.getItem('gw-side-collapsed') === '1')
  }, [])
  const toggleSidebar = useCallback(() => {
    setSideCollapsed((v) => {
      const next = !v
      try {
        window.localStorage.setItem('gw-side-collapsed', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // Close the mobile nav on navigation.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  const chromeless = CHROMELESS_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  const activeModuleId = useMemo(() => deriveActiveModuleId(pathname, railItems), [pathname, railItems])
  const activeItem = useMemo(
    () => railItems.find((it) => it.moduleId === activeModuleId) ?? null,
    [railItems, activeModuleId],
  )
  const activeEntry = activeModuleId ? access[activeModuleId] : undefined
  const activeIsAdmin = activeEntry?.access === 'admin'

  const nav = useMemo<PortalShellNavEntry[]>(() => {
    if (!activeItem) return []
    return activeIsAdmin ? activeItem.nav : activeItem.publicNav
  }, [activeItem, activeIsAdmin])

  const navLabel = useMemo(() => {
    const match = nav.filter(isNavItem).find((it) => pathname === it.href || pathname.startsWith(it.href + '/'))
    return match?.label ?? null
  }, [nav, pathname])

  if (chromeless) {
    return <>{children}</>
  }

  const showSidebar = !activeItem?.fullBleed && nav.length > 0
  const content = activeEntry?.access === 'gated' ? <SignInGate label={activeItem?.full} /> : children

  return (
    <ShellProvider access={access} activeModuleId={activeModuleId} featureKeys={featureKeys} isSuperAdmin={isSuperAdmin}>
      {/* Prototype structure: rail | (app: sidebar + main(top + content)) — the full-width
          header lives inside .gw-main but spans .gw-app via absolute positioning. */}
      <div className={`gw-ws-root${sideCollapsed ? ' side-collapsed' : ''}${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
        <ModuleRail
          items={railItems}
          access={access}
          activeModuleId={activeModuleId}
          brandName={brandName}
          logoIconUrl={logoIconUrl}
          sideCollapsed={sideCollapsed}
          onToggleSidebar={toggleSidebar}
          showCollapse={showSidebar}
        />
        <div className="gw-ws-body">
          <div className="gw-app">
            {showSidebar && <ContextualSidebar nav={nav} featureKeys={featureKeys} />}
            <div className="gw-main">
              <ShellHeader
                activeItem={activeItem}
                activeIsAdmin={activeIsAdmin}
                navLabel={navLabel}
                onToggleMobileNav={() => setMobileNavOpen((v) => !v)}
              />
              <main className="gw-content">
                <ShellErrorBoundary resetKey={pathname}>{content}</ShellErrorBoundary>
              </main>
            </div>
          </div>
        </div>
      </div>
    </ShellProvider>
  )
}

export default WorkspaceShell
