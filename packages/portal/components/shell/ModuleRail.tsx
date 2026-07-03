'use client'

/**
 * ModuleRail — the persistent far-left icon rail. One item per enabled module (hidden when its
 * access is 'hidden'), brand mark on top, collapse chevron + avatar/sign-out at the bottom.
 * Rail items link to the module's admin landing when access==='admin', else its public route.
 * Spec §7.1.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { getClientBrandConfig } from '@/config/brand'
import { Icon } from '@/components/ui/Icon'
import { Avatar } from '@/components/ui/Avatar'
import type { RailItem } from '@/lib/modules/enabledModules'
import type { ModuleAccessMap } from '@/lib/modules/access'
import { signInHref } from '@/lib/signInHref'

interface ModuleRailProps {
  items: RailItem[]
  access: ModuleAccessMap
  activeModuleId: string | null
  brandName: string
  logoIconUrl?: string
  sideCollapsed: boolean
  onToggleSidebar: () => void
  showCollapse: boolean
}

export function ModuleRail({
  items,
  access,
  activeModuleId,
  brandName,
  logoIconUrl,
  sideCollapsed,
  onToggleSidebar,
  showCollapse,
}: ModuleRailProps) {
  const { user, session, signOut } = useAuth()
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  // Sign-in (logged-out rail) carries the current page for the post-auth return.
  const railPathname = usePathname()

  // Resolve the signed-in person's avatar (rail account button). Auth
  // user_metadata carries no picture, so read it from the person record:
  // a stored avatar (avatar_storage_path → public URL), else a full-URL
  // avatar_url, else the LFID profile picture. Falls back to initials.
  useEffect(() => {
    if (!user || !session?.access_token) {
      setAvatarSrc(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const config = getClientBrandConfig()
        const { createClient } = await import('@supabase/supabase-js')
        const sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${session.access_token}` } },
        })
        const { data: person } = await sb
          .from('people')
          .select('attributes, avatar_storage_path')
          .eq('auth_user_id', user.id)
          .maybeSingle()
        if (cancelled || !person) return
        const attrs = (person.attributes ?? {}) as Record<string, unknown>
        let src: string | null = null
        if (person.avatar_storage_path) {
          src = sb.storage.from('media').getPublicUrl(person.avatar_storage_path as string).data.publicUrl
        } else if (typeof attrs.avatar_url === 'string' && /^https?:\/\//.test(attrs.avatar_url)) {
          src = attrs.avatar_url
        } else if (typeof attrs.lfid_picture_src === 'string' && /^https?:\/\//.test(attrs.lfid_picture_src)) {
          src = attrs.lfid_picture_src
        }
        if (!cancelled) setAvatarSrc(src)
      } catch {
        /* non-fatal → initials */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, session])

  // Account menu open state. JS-controlled with a short close delay so moving
  // the pointer from the avatar across the gap into the menu never drops it
  // (a pure CSS :hover bridge is too fragile). Keyboard uses :focus-within.
  // Account menu: click-to-open, closes on outside click / Escape. The menu is
  // PORTALLED to <body>: the rail has a backdrop-filter (its own stacking
  // context) and the content area is a later sibling that paints — and captures
  // pointer events — over anything the rail positions into it. Portalling lets
  // the menu escape that entirely; it's positioned from the avatar's rect.
  const [acctOpen, setAcctOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 })
  const avatarRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => setMounted(true), [])

  const toggleAcct = () => {
    if (acctOpen) {
      setAcctOpen(false)
      return
    }
    const r = avatarRef.current?.getBoundingClientRect()
    if (r) setMenuPos({ left: Math.round(r.right + 10), bottom: Math.round(window.innerHeight - r.bottom) })
    setAcctOpen(true)
  }

  useEffect(() => {
    if (!acctOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (avatarRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setAcctOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAcctOpen(false)
    }
    const onReflow = () => setAcctOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReflow)
    }
  }, [acctOpen])

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email ||
    undefined

  const visible = items.filter((it) => access[it.moduleId]?.access !== 'hidden')

  return (
    <nav className="gw-rail" aria-label="Modules">
      <Link href="/" className="gw-rail-mark" title={brandName} aria-label={brandName}>
        {logoIconUrl ? (
          <Image src={logoIconUrl} alt={brandName} width={30} height={30} />
        ) : (
          <Icon name="home" size={26} />
        )}
      </Link>

      {visible.map((it) => {
        const isAdmin = access[it.moduleId]?.access === 'admin'
        const href = isAdmin ? it.adminHref : it.href
        return (
          <Link
            key={it.moduleId}
            href={href}
            className={`gw-rail-item${activeModuleId === it.moduleId ? ' on' : ''}`}
            title={it.full || it.label}
            aria-current={activeModuleId === it.moduleId ? 'page' : undefined}
          >
            <Icon name={it.icon} size={21} />
            <span className="rl">{it.label}</span>
          </Link>
        )
      })}

      <span className="gw-rail-sp" />

      {showCollapse && (
        <button
          type="button"
          className="gw-rail-collapse"
          title={sideCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-label={sideCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          onClick={onToggleSidebar}
        >
          <Icon name={sideCollapsed ? 'panelOpen' : 'panelClose'} size={18} />
        </button>
      )}

      {user ? (
        // Account: click the avatar to open a menu (edit profile / sign out);
        // it closes on a click outside or Escape. Signing out is a deliberate
        // menu choice, never a stray click on the avatar.
        <div className="gw-rail-acct">
          <button
            ref={avatarRef}
            type="button"
            className="gw-rail-av"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={acctOpen}
            title={displayName}
            onClick={toggleAcct}
          >
            <Avatar src={avatarSrc} name={displayName} size={36} />
          </button>
          {mounted && acctOpen && (createPortal(
            <div
              ref={menuRef}
              className="gw-rail-acct-menu"
              role="menu"
              style={{ position: 'fixed', left: menuPos.left, bottom: menuPos.bottom }}
            >
              <div className="gw-rail-acct-panel">
                <Link href="/profile" className="gw-rail-acct-item" role="menuitem" onClick={() => setAcctOpen(false)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Edit profile
                </Link>
                <button type="button" className="gw-rail-acct-item" role="menuitem" onClick={() => { setAcctOpen(false); signOut() }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>
              </div>
            </div>,
            document.body,
          ) as React.ReactNode)}
        </div>
      ) : (
        <Link href={signInHref(railPathname)} className="gw-rail-collapse" title="Sign in" aria-label="Sign in">
          <Icon name="signin" size={18} />
        </Link>
      )}
    </nav>
  )
}

export default ModuleRail
