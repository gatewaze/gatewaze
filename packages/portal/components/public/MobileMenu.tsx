'use client'

/**
 * MobileMenu — the mobile hamburger that animates into an X and opens a
 * full-screen overlay whose contents fade/stagger in. Lifted from the legacy
 * Header so the portal keeps the same mobile menu behaviour. Self-contained:
 * renders the trigger button (caller places it in the top bar) plus the
 * overlay. Shown only on mobile via CSS (`.gw-mobile-only`).
 *
 * The overlay is portalled to <body> so it always covers the viewport: the
 * (main)/template.tsx framer-motion wrapper leaves a `transform` on an
 * ancestor, which would otherwise contain `position: fixed` descendants (this
 * is why the signed-in menu didn't appear). Nav moves here on mobile, so the
 * bottom nav bar is removed (CSS).
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { RailItem } from '@/lib/modules/enabledModules'

interface MobileMenuProps {
  items: RailItem[]
  activeModuleId: string | null
  /** Signed-in → admin landing per item; logged-out / public → public href. */
  useAdminHref?: boolean
  /** Brand shown at the top-left of the overlay, in line with the X (matches the top bar). */
  brand?: React.ReactNode
  /** Account section at the bottom of the overlay (sign-in link, or profile/sign-out). */
  footer?: React.ReactNode
}

export function MobileMenu({ items, activeModuleId, useAdminHref = false, brand, footer }: MobileMenuProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // Separate "animating" flag: mount at opacity 0, then flip to 1 next frame so
  // the overlay + items transition in (and out) rather than snapping.
  const [animating, setAnimating] = useState(false)
  // Portal target is only available on the client.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const openMenu = useCallback(() => {
    setOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimating(true)))
  }, [])
  const closeMenu = useCallback(() => {
    setAnimating(false)
    setTimeout(() => setOpen(false), 300) // match the fade duration
  }, [])

  // Close on route change.
  useEffect(() => { setAnimating(false); setOpen(false) }, [pathname])

  // Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, closeMenu])

  const overlay = (
    <div className="gw-mobile-menu" style={{ opacity: animating ? 1 : 0 }} role="dialog" aria-modal="true">
      {/* Brand (left) + close X (right) — in line, matching the top bar. */}
      <div className="gw-mobile-menu-head">
        {brand ? <div className="gw-mobile-menu-brand">{brand}</div> : <span />}
        <button type="button" className="gw-burger-btn" onClick={closeMenu} aria-label="Close menu">
          <span className="gw-burger-box" aria-hidden>
            <span className="gw-burger-line" style={{ top: '9px', transform: 'rotate(45deg)' }} />
            <span className="gw-burger-line" style={{ top: '9px', transform: 'rotate(-45deg)' }} />
          </span>
        </button>
      </div>

      <nav className="gw-mobile-menu-nav">
        <div>
          {items.map((it, i) => {
            const href = useAdminHref ? it.adminHref : it.href
            const label = it.label.endsWith('.') ? it.full || it.label : it.label
            const isActive = it.moduleId === activeModuleId
            return (
              <Link
                key={it.moduleId}
                href={href}
                onClick={closeMenu}
                className={`gw-mobile-menu-link${isActive ? ' on' : ''}`}
                style={{
                  opacity: animating ? 1 : 0,
                  transform: animating ? 'translateY(0)' : 'translateY(12px)',
                  transitionDelay: animating ? `${100 + i * 55}ms` : '0ms',
                }}
              >
                {label}
              </Link>
            )
          })}
        </div>

        {footer && (
          <div
            className="gw-mobile-menu-foot"
            style={{ opacity: animating ? 1 : 0, transitionDelay: animating ? '380ms' : '0ms' }}
            onClick={closeMenu}
          >
            {footer}
          </div>
        )}
      </nav>
    </div>
  )

  return (
    <>
      {/* Trigger — hamburger that animates into an X. Mobile-only (CSS). */}
      <button
        type="button"
        className="gw-burger-btn gw-mobile-only"
        onClick={open ? closeMenu : openMenu}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        <span className="gw-burger-box" aria-hidden>
          <span className="gw-burger-line" style={{ top: animating ? '9px' : '2px', transform: animating ? 'rotate(45deg)' : 'none' }} />
          <span className="gw-burger-line" style={{ top: '9px', opacity: animating ? 0 : 1, transform: animating ? 'scaleX(0)' : 'none' }} />
          <span className="gw-burger-line" style={{ top: animating ? '9px' : '16px', transform: animating ? 'rotate(-45deg)' : 'none' }} />
        </span>
      </button>

      {open && mounted ? createPortal(overlay, document.body) : null}
    </>
  )
}

export default MobileMenu
