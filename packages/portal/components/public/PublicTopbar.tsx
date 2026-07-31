'use client'

/**
 * PublicTopbar — the logged-out website chrome (prototype PublicArea): brand logo + horizontal nav
 * + Sign in. Transparent at the top; a blurred gradient fades in on scroll (handled by the parent
 * toggling `.scrolled`). No rail/sidebar — logged-out users get a flat website. Spec §8 / §11.
 */
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/Icon'
import { MobileMenu } from './MobileMenu'
import type { RailItem } from '@/lib/modules/enabledModules'
import { signInHref } from '@/lib/signInHref'
import { useEffect, useState } from 'react'

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
  // Sign-in carries the current page so the user returns here after auth.
  const pathname = usePathname()
  const signIn = signInHref(pathname)
  // Immediate feedback on click: the sign-in icon becomes a spinner while the
  // browser navigates (the SSO flow can take a beat before anything visibly
  // happens). Reset on route change so a back-navigation doesn't strand it.
  const [signingIn, setSigningIn] = useState(false)
  useEffect(() => { setSigningIn(false) }, [pathname])
  const signInIcon = (size: number) =>
    signingIn ? <span className="gw-signin-spin ic" aria-hidden /> : <Icon name="signin" size={size} className="ic" />

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
        <Link href={signIn} className="btn btn-primary btn-sm gw-desktop-only" onClick={() => setSigningIn(true)}>
          {signInIcon(14)}
          Sign in
        </Link>
        <MobileMenu
          items={nav}
          activeModuleId={activeModuleId}
          footer={
            menuFooter ?? (
              <Link href={signIn} className="gw-mobile-menu-foot-link" onClick={() => setSigningIn(true)}>
                {signInIcon(18)}
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
