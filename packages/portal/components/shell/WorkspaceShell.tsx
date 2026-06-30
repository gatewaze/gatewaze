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
import Link from 'next/link'
import type { RailItem } from '@/lib/modules/enabledModules'
import type { ModuleAccessMap } from '@/lib/modules/access'
import type { PortalShellNavEntry, PortalShellNavItem } from '@gatewaze/shared'
import { useAuth } from '@/hooks/useAuth'
import { ShellProvider } from './ShellContext'
import { ModuleRail } from './ModuleRail'
import { ContextualSidebar } from './ContextualSidebar'
import { ShellHeader } from './ShellHeader'
import { ShellErrorBoundary } from './ShellErrorBoundary'
import { SignInGate } from './SignInGate'
import { PublicTopbar } from '@/components/public/PublicTopbar'

/** Paths that render without shell chrome (full-bleed auth screens). */
const CHROMELESS_PATHS = ['/sign-in', '/auth/callback']

interface WorkspaceShellProps {
  railItems: RailItem[]
  access: ModuleAccessMap
  featureKeys: string[]
  isSuperAdmin: boolean
  /** Validated session present → render the rail workspace; else render the flat public website. */
  isSignedIn: boolean
  brandName: string
  logoUrl?: string
  logoIconUrl?: string
  /** When the compliance module is enabled, the footer shows the Privacy/Terms/Do-Not-Sell links.
   *  When disabled, it shows `footerLegalHtml` (a single configurable line) instead. */
  complianceEnabled?: boolean
  /** Pre-sanitized HTML shown in the footer when compliance is disabled (configured in admin). */
  footerLegalHtml?: string | null
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
  // Match on the first path segment so every sub-route of a module resolves to the same rail item
  // regardless of the rail href's deeper landing path. e.g. the events rail links to
  // '/events/upcoming', but '/events/past', '/events/<id>' etc. must all map to 'events' — otherwise
  // activeModuleId flips to null on those routes, dropping the nav highlight and (because the content
  // wrapper is keyed on activeModuleId) forcing a full remount + page-fade on every Upcoming↔Past switch.
  const seg = '/' + (pathname.split('/')[1] || '')
  if (seg === '/') return null
  let best: { id: string; len: number } | null = null
  for (const it of items) {
    const base = it.href.split('?')[0]
    const itemSeg = '/' + (base.split('/')[1] || '')
    if (itemSeg !== '/' && itemSeg === seg) {
      if (!best || itemSeg.length > best.len) best = { id: it.moduleId, len: itemSeg.length }
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
  isSignedIn,
  brandName,
  logoUrl,
  logoIconUrl,
  complianceEnabled = false,
  footerLegalHtml = null,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname() || '/'
  const { signOut } = useAuth()
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

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

  // Signed-in mobile: the document scrolls (the logged-out site scrolls inside
  // .pub-area instead), so track window scroll to fade in the mobile top bar's
  // blur, matching the logged-out PublicTopbar behaviour.
  useEffect(() => {
    if (!isSignedIn) return
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isSignedIn])

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
    // The (main) layout wraps the shell in a `flex` row. Returning children bare
    // would make the chromeless page (e.g. sign-in) a flex item that shrinks to
    // its content width and pins to the left. Fill the row so in-flow centring
    // (min-h-screen flex items-center justify-center) resolves against the full
    // viewport width.
    return <div className="flex-1 w-full min-w-0">{children}</div>
  }

  // Logged out → flat public website (prototype PublicArea): a slim top bar over the content,
  // no rail / no sidebar. The blurred top-bar background fades in on scroll.
  if (!isSignedIn) {
    return (
      <ShellProvider access={access} activeModuleId={activeModuleId} featureKeys={featureKeys} isSuperAdmin={isSuperAdmin}>
        <div
          className="pub-area gw-scroll"
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
        >
          <PublicTopbar
            items={railItems}
            activeModuleId={activeModuleId}
            brandName={brandName}
            logoUrl={logoUrl}
            logoIconUrl={logoIconUrl}
            scrolled={scrolled}
          />
          <main>
            <div key={activeModuleId ?? pathname} className="pub-fade">
              <ShellErrorBoundary resetKey={pathname}>{children}</ShellErrorBoundary>
            </div>
          </main>
          <footer className="pub-foot">
            {complianceEnabled ? (
              <>
                <a className="pub-flink" href="/privacy">Privacy Policy</a>
                <span className="sep">|</span>
                <a className="pub-flink" href="/terms">Terms of Service</a>
                <span className="sep">|</span>
                <a className="pub-flink" href="/do-not-sell">Do Not Sell My Info</a>
              </>
            ) : footerLegalHtml ? (
              <div className="pub-foot-text" dangerouslySetInnerHTML={{ __html: footerLegalHtml }} />
            ) : null}
          </footer>
        </div>
      </ShellProvider>
    )
  }

  const showSidebar = !activeItem?.fullBleed && nav.length > 0
  const content = activeEntry?.access === 'gated' ? <SignInGate label={activeItem?.full} /> : children

  return (
    <ShellProvider access={access} activeModuleId={activeModuleId} featureKeys={featureKeys} isSuperAdmin={isSuperAdmin}>
      {/* Prototype structure: rail | (app: sidebar + main(top + content)) — the full-width
          header lives inside .gw-main but spans .gw-app via absolute positioning. */}
      <div className={`gw-ws-root${sideCollapsed ? ' side-collapsed' : ''}${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
        {/* Mobile-only top bar — the SAME PublicTopbar used logged-out, so the
            signed-in bar is identical (logo, positioning, scroll fade). On
            mobile the icon rail (bottom tab bar) is hidden and module nav lives
            in the hamburger overlay. Admin sections render ShellHeader instead,
            so this only shows on non-admin views. */}
        {!activeIsAdmin && (
          <PublicTopbar
            className="gw-signed-topbar"
            items={railItems.filter((it) => access[it.moduleId]?.access !== 'hidden')}
            activeModuleId={activeModuleId}
            brandName={brandName}
            logoUrl={logoUrl}
            logoIconUrl={logoIconUrl}
            scrolled={scrolled}
            menuFooter={
              <div className="gw-mobile-menu-acct">
                <Link href="/profile" className="gw-mobile-menu-foot-link">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Profile
                </Link>
                <button type="button" className="gw-mobile-menu-foot-link" onClick={() => signOut()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>
              </div>
            }
          />
        )}
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
              {/* Top bar only renders where the user has admin access to the
                  section (its breadcrumb/back-nav is for the module admin).
                  Public / non-admin views render chrome-free. */}
              {activeIsAdmin && (
                <ShellHeader
                  activeItem={activeItem}
                  activeIsAdmin={activeIsAdmin}
                  navLabel={navLabel}
                  onToggleMobileNav={() => setMobileNavOpen((v) => !v)}
                />
              )}
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
