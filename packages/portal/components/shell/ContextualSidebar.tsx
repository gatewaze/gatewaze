'use client'

/**
 * ContextualSidebar — the active module's own nav. Renders the admin nav when the module's access
 * is 'admin', else its public nav. A page may override the nav via ShellContext (e.g. a newsletter
 * detail page publishes per-newsletter sub-nav). Suppressed for `fullBleed` modules. Spec §7.1.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/Icon'
import { useShell } from './ShellContext'
import type { PortalShellNavEntry, PortalShellNavItem } from '@gatewaze/shared'

function isSection(entry: PortalShellNavEntry): entry is { section: string } {
  return (entry as { section?: string }).section !== undefined
}

export function ContextualSidebar({
  nav,
  featureKeys,
}: {
  nav: PortalShellNavEntry[]
  featureKeys: string[]
}) {
  const pathname = usePathname()
  const { navOverride } = useShell()
  const entries = navOverride ?? nav

  if (!entries || entries.length === 0) return null

  return (
    <aside className="gw-side" aria-label="Section navigation">
      <nav className="gw-nav">
        {entries.map((entry, i) => {
          if (isSection(entry)) {
            return (
              <div key={`s-${i}`} className="gw-nav-sec">
                {entry.section}
              </div>
            )
          }
          const item = entry as PortalShellNavItem
          if (item.requiredFeature && !featureKeys.includes(item.requiredFeature)) return null
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link key={item.id} href={item.href} className={`gw-nav-item${active ? ' active' : ''}`}>
              <Icon name={item.icon} size={17} className="ic" />
              <span className="lbl">{item.label}</span>
              {item.count != null && <span className="gw-pill-num">{item.count}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}

export default ContextualSidebar
