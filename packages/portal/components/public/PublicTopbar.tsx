'use client'

/**
 * PublicTopbar — the logged-out website chrome (prototype PublicArea): brand logo + horizontal nav
 * + Sign in. Transparent at the top; a blurred gradient fades in on scroll (handled by the parent
 * toggling `.scrolled`). No rail/sidebar — logged-out users get a flat website. Spec §8 / §11.
 */
import Link from 'next/link'
import Image from 'next/image'
import { Icon } from '@/components/ui/Icon'
import { MobileMenu } from './MobileMenu'
import type { RailItem } from '@/lib/modules/enabledModules'

interface PublicTopbarProps {
  items: RailItem[]
  activeModuleId: string | null
  brandName: string
  logoUrl?: string
  logoIconUrl?: string
  scrolled: boolean
  /** Extra class on the root (e.g. to mark the signed-in mobile instance). */
  className?: string
  /** Mobile-menu account section. Defaults to a Sign in link (logged-out). */
  menuFooter?: React.ReactNode
}

export function PublicTopbar({ items, activeModuleId, brandName, logoUrl, logoIconUrl, scrolled, className, menuFooter }: PublicTopbarProps) {
  // Public nav = rail items visible to the public (Home is always public).
  const nav = items.filter((it) => it.visibility === 'public')

  // Brand mark: full logo when configured, else icon + name. Shared by the top
  // bar and the mobile menu head so they're identical.
  const brandContent = logoUrl ? (
    <img src={logoUrl} alt={brandName} className="pub-logo-img" />
  ) : logoIconUrl ? (
    <>
      <Image src={logoIconUrl} alt="" width={24} height={24} />
      <span>{brandName}</span>
    </>
  ) : (
    <span>{brandName}</span>
  )

  return (
    <div className={`pub-topbar${scrolled ? ' scrolled' : ''}${className ? ` ${className}` : ''}`}>
      <Link href="/" className="brand" aria-label={brandName}>
        {brandContent}
      </Link>

      <nav className="pub-nav">
        {nav.map((it) => {
          // The website top bar has room for full names; the narrow rail uses abbreviations
          // (e.g. "Ambass."). Expand abbreviated labels to `full` here (→ "Ambassadors"), but keep
          // already-short labels like "News".
          const label = it.label.endsWith('.') ? it.full || it.label : it.label
          return (
            <Link
              key={it.moduleId}
              href={it.href}
              className={`pub-link${activeModuleId === it.moduleId ? ' on' : ''}${it.moduleId === 'home' ? ' pub-link-home' : ''}`}
            >
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="right">
        {/* Desktop: inline Sign in. Mobile: the hamburger menu (which carries
            the nav + a Sign in link); the desktop button is hidden on mobile. */}
        <Link href="/sign-in?sso=1" className="btn btn-primary btn-sm gw-desktop-only">
          <Icon name="signin" size={14} className="ic" />
          Sign in
        </Link>
        <MobileMenu
          items={nav}
          activeModuleId={activeModuleId}
          footer={
            menuFooter ?? (
              <Link href="/sign-in?sso=1" className="gw-mobile-menu-foot-link">
                <Icon name="signin" size={18} className="ic" />
                Sign in
              </Link>
            )
          }
        />
      </div>
    </div>
  )
}

export default PublicTopbar
