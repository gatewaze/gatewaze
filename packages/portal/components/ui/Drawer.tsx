'use client'

/**
 * Drawer — right-slide panel over a fading backdrop. Closes on backdrop click, Esc, or the close
 * button. Mounts/unmounts with an exit transition so the panel slides back out and the backdrop
 * fades before removal. Uses the neutral frosted recipe from shell.css (`.gw-drawer`).
 */
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  /** Panel width in px (desktop). Goes full-width on mobile via shell.css. */
  width?: number
  className?: string
}

export function Drawer({ open, onClose, title, children, width = 480, className }: DrawerProps) {
  // Keep the node mounted briefly while the close animation plays.
  const [mounted, setMounted] = useState(open)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      if (closeTimer.current) clearTimeout(closeTimer.current)
      setMounted(true)
    } else if (mounted) {
      closeTimer.current = setTimeout(() => setMounted(false), 280)
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div className={`gw-drawer-root ${open ? 'is-open' : 'is-closing'}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="gw-drawer-backdrop" onClick={onClose} aria-hidden />
      <aside className={`gw-drawer ${className ?? ''}`} style={{ width }}>
        <header className="gw-drawer-head">
          {title && <h2 className="gw-drawer-title">{title}</h2>}
          <button type="button" className="gw-drawer-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="gw-drawer-body">{children}</div>
      </aside>
    </div>
  )
}

export default Drawer
