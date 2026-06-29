'use client'

/**
 * ShellHeader — full-width top bar spanning over the sidebar: hamburger (mobile) · breadcrumb ·
 * search (stubbed v1, D1) · notification bell (stubbed v1). Spec §7.1.
 */
import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import { useShell } from './ShellContext'
import type { RailItem } from '@/lib/modules/enabledModules'

interface ShellHeaderProps {
  activeItem: RailItem | null
  activeIsAdmin: boolean
  /** Matched contextual nav label for the current path, if any. */
  navLabel: string | null
  onToggleMobileNav: () => void
}

export function ShellHeader({ activeItem, activeIsAdmin, navLabel, onToggleMobileNav }: ShellHeaderProps) {
  const { breadcrumbLeaf } = useShell()
  const rootLabel = activeItem?.label ?? 'Home'
  const rootHref = activeItem ? (activeIsAdmin ? activeItem.adminHref : activeItem.href) : '/'
  const leaf = breadcrumbLeaf ?? navLabel

  return (
    <header className="gw-top">
      <button type="button" className="gw-top-ico gw-burger" aria-label="Toggle navigation" onClick={onToggleMobileNav}>
        <Icon name="menu" size={20} />
      </button>

      <div className="gw-crumb">
        <Link href={rootHref} className="gw-crumb-link">
          {rootLabel}
        </Link>
        {leaf && (
          <>
            <span className="sep">/</span>
            <span className="cur">{leaf}</span>
          </>
        )}
      </div>

      {/* Search + notification bell intentionally hidden for now (not ready). */}
    </header>
  )
}

export default ShellHeader
