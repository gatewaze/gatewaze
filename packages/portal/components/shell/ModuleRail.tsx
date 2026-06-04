'use client'

/**
 * ModuleRail — the persistent far-left icon rail. One item per enabled module (hidden when its
 * access is 'hidden'), brand mark on top, collapse chevron + avatar/sign-out at the bottom.
 * Rail items link to the module's admin landing when access==='admin', else its public route.
 * Spec §7.1.
 */
import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/hooks/useAuth'
import { Icon } from '@/components/ui/Icon'
import { Avatar } from '@/components/ui/Avatar'
import type { RailItem } from '@/lib/modules/enabledModules'
import type { ModuleAccessMap } from '@/lib/modules/access'

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
  const { user, signOut } = useAuth()

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
        <button type="button" className="gw-rail-av" title="Sign out" onClick={() => signOut()}>
          <Avatar name={user.email ?? undefined} size={36} />
        </button>
      ) : (
        <Link href="/sign-in" className="gw-rail-collapse" title="Sign in" aria-label="Sign in">
          <Icon name="signin" size={18} />
        </Link>
      )}
    </nav>
  )
}

export default ModuleRail
