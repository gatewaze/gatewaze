'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import type { BrandConfig } from '@/config/brand'
import type { PortalNavItem } from '@/lib/modules/enabledModules'

interface Props {
  brandConfig: BrandConfig
  navItems?: PortalNavItem[]
}

interface UserProfile {
  firstName: string
  avatarUrl: string | null
}

export function Header({ brandConfig, navItems = [] }: Props) {
  const { user, session, isLoading, signOut } = useAuth()
  const pathname = usePathname()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [profileRefreshKey, setProfileRefreshKey] = useState(0)

  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileMenuAnimating, setMobileMenuAnimating] = useState(false)

  const isOnSignInPage = pathname === '/sign-in'

  const [iconError, setIconError] = useState(false)
  const [logoError, setLogoError] = useState(false)
  const hasFullLogo = !!brandConfig.logoUrl && !logoError
  const showFullLogo = hasFullLogo

  const isLightBg = typeof document !== 'undefined' && document.documentElement.classList.contains('light-brand')

  // Close desktop dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Profile updates listener
  useEffect(() => {
    const handler = () => setProfileRefreshKey(k => k + 1)
    window.addEventListener('user-profile-updated', handler)
    return () => window.removeEventListener('user-profile-updated', handler)
  }, [])

  // Fetch user profile
  useEffect(() => {
    if (!session?.access_token || !user) {
      setUserProfile(null)
      return
    }

    let cancelled = false
    async function fetchUserProfile() {
      try {
        const config = getClientBrandConfig()
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${session!.access_token}` } }
        })

        const { data: person } = await supabase
          .from('people')
          .select('attributes, avatar_storage_path')
          .eq('auth_user_id', user!.id)
          .maybeSingle()

        if (!cancelled && person) {
          const attrs = (person.attributes as Record<string, string>) || {}
          let avatarUrl: string | null = null

          if (person.avatar_storage_path) {
            const { data: { publicUrl } } = supabase.storage
              .from('media')
              .getPublicUrl(person.avatar_storage_path)
            avatarUrl = publicUrl
          }

          setUserProfile({
            firstName: attrs.first_name || '',
            avatarUrl,
          })
        }
      } catch (err) {
        console.error('Error fetching user profile:', err)
      }
    }

    fetchUserProfile()
    return () => { cancelled = true }
  }, [session?.access_token, user?.id, profileRefreshKey])

  const handleSignOut = async () => {
    await signOut()
    setIsMenuOpen(false)
    closeMobileMenu()
  }

  // Mobile menu handlers
  const openMobileMenu = useCallback(() => {
    setMobileMenuOpen(true)
    document.body.style.overflow = 'hidden'
    setTimeout(() => setMobileMenuAnimating(true), 10)
  }, [])

  const closeMobileMenu = useCallback(() => {
    setMobileMenuAnimating(false)
    setTimeout(() => {
      setMobileMenuOpen(false)
      document.body.style.overflow = ''
    }, 400)
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    closeMobileMenu()
  }, [pathname])

  // Escape key closes mobile menu
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) closeMobileMenu()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [mobileMenuOpen, closeMobileMenu])

  const displayName = userProfile?.firstName || user?.email?.split('@')[0] || '?'
  const avatarInitial = (userProfile?.firstName || user?.email || '?').charAt(0).toUpperCase()

  const allNavItems = [{ moduleId: '_home', label: 'Home', path: '/', icon: 'home', order: 0 }, ...navItems]

  return (
    <>
      <header className="relative z-50">
        <div className="relative flex items-center justify-between p-4 min-h-[56px]">
          {/* Logo */}
          <Link href="/" className="grid hover:opacity-80 transition-opacity ml-2 shrink-0" style={{ gridTemplate: '1fr / 1fr' }}>
            {brandConfig.logoIconUrl && !iconError ? (
              <img
                src={brandConfig.logoIconUrl}
                alt={brandConfig.name}
                className="h-8 w-auto col-start-1 row-start-1 self-center transition-opacity duration-300"
                style={{
                  opacity: showFullLogo ? 0 : 1,
                  filter: isLightBg ? 'none' : 'brightness(0) invert(1)',
                }}
                onError={() => setIconError(true)}
              />
            ) : (
              <span
                className="h-8 col-start-1 row-start-1 self-center font-semibold text-xl transition-opacity duration-300"
                style={{
                  opacity: showFullLogo ? 0 : 1,
                  color: isLightBg ? '#000000' : '#ffffff',
                }}
              >
                {brandConfig.name}
              </span>
            )}
            {hasFullLogo && (
              <img
                src={brandConfig.logoUrl}
                alt={brandConfig.name}
                className="h-8 w-auto col-start-1 row-start-1 self-center transition-opacity duration-300"
                style={{
                  opacity: showFullLogo ? 1 : 0,
                  filter: isLightBg ? 'none' : 'brightness(0) invert(1)',
                }}
                onError={() => setLogoError(true)}
              />
            )}
          </Link>

          {/* Desktop Navigation — centered */}
          {navItems.length >= 2 && (
            <nav className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-8 overflow-x-auto">
              {allNavItems.map((item) => {
                const isActive = item.path === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.path.replace(/\/upcoming$/, '')) || pathname === item.path
                return (
                  <Link
                    key={item.moduleId}
                    href={item.path}
                    className={`relative whitespace-nowrap transition-colors group ${
                      isActive ? 'text-white' : 'text-white/60 hover:text-white'
                    }`}
                    style={{ fontSize: 'max(1rem, 16px)' }}
                  >
                    {item.label}
                    <span className={`absolute bottom-0 left-0 h-0.5 bg-white/60 transition-all duration-300 ${
                      isActive ? 'w-full' : 'w-0 group-hover:w-full'
                    }`} />
                  </Link>
                )
              })}
            </nav>
          )}

          {/* Right side */}
          <div className="flex items-center gap-3 min-h-[40px]">
            {/* Desktop auth */}
            <nav className="hidden md:flex items-center gap-4">
              {isLoading ? (
                <div className="w-20 h-8 bg-white/10 rounded animate-pulse" />
              ) : user ? (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className="flex items-center gap-2 px-2 py-1.5 bg-white/10 hover:bg-white/20 transition-colors text-white text-sm cursor-pointer"
                    style={{ borderRadius: 'var(--radius-control)' }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium overflow-hidden"
                      style={{ backgroundColor: userProfile?.avatarUrl ? undefined : brandConfig.primaryColor, color: isLightColor(brandConfig.primaryColor) ? '#000000' : '#ffffff' }}
                    >
                      {userProfile?.avatarUrl ? (
                        <img src={userProfile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                      ) : (
                        avatarInitial
                      )}
                    </div>
                    <span className="pr-1">{displayName}</span>
                    <svg className={`w-4 h-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isMenuOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-black/50 backdrop-blur-xl border border-white/10 rounded-lg shadow-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-white/10">
                        <p className="text-sm text-white font-medium">{displayName}</p>
                        <p className="text-xs text-gray-400 truncate">{user.email}</p>
                      </div>
                      <div className="py-1">
                        <Link href="/profile" onClick={() => setIsMenuOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                          Profile
                        </Link>
                      </div>
                      <div className="border-t border-white/10 py-1">
                        <button onClick={handleSignOut} className="flex items-center gap-3 w-full px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                          Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : !isOnSignInPage ? (
                <Link
                  href={`/sign-in?redirectTo=${encodeURIComponent(pathname)}`}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-white/20 transition-colors text-white font-medium"
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  Sign in
                </Link>
              ) : null}
            </nav>

            {/* Mobile hamburger button — animates into X, stays on top of overlay */}
            <button
              className="md:hidden relative w-11 h-11 flex items-center justify-center"
              onClick={mobileMenuOpen ? closeMobileMenu : openMobileMenu}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              <div className="w-6 h-6 relative" style={{ marginTop: '-1px' }}>
                <span
                  className="absolute left-0 block h-[2px] w-full bg-white rounded-full transition-all duration-300"
                  style={{ top: mobileMenuAnimating ? '11px' : '5px', transform: mobileMenuAnimating ? 'rotate(45deg)' : 'rotate(0)' }}
                />
                <span
                  className="absolute left-0 top-[11px] block h-[2px] w-full bg-white rounded-full transition-all duration-300"
                  style={{ opacity: mobileMenuAnimating ? 0 : 1, transform: mobileMenuAnimating ? 'scaleX(0)' : 'scaleX(1)' }}
                />
                <span
                  className="absolute left-0 block h-[2px] w-full bg-white rounded-full transition-all duration-300"
                  style={{ top: mobileMenuAnimating ? '11px' : '17px', transform: mobileMenuAnimating ? 'rotate(-45deg)' : 'rotate(0)' }}
                />
              </div>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu — Full-screen overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-[999] flex flex-col transition-opacity duration-300"
          style={{
            backgroundColor: 'rgba(10, 10, 20, 0.85)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            opacity: mobileMenuAnimating ? 1 : 0,
          }}
        >
          {/* Close button — top right, matching header height */}
          <div className="flex items-center justify-end p-4 min-h-[56px] flex-shrink-0">
            <button
              className="w-11 h-11 flex items-center justify-center"
              onClick={closeMobileMenu}
              aria-label="Close menu"
            >
              <div className="w-6 h-6 relative flex items-center justify-center" style={{ marginTop: '2px' }}>
                <span className="absolute block h-[2px] w-[23px] bg-white rounded-full rotate-45" />
                <span className="absolute block h-[2px] w-[23px] bg-white rounded-full -rotate-45" />
              </div>
            </button>
          </div>

          {/* Navigation items */}
          <nav className="flex-1 px-10 flex flex-col overflow-y-auto">
            <div className="space-y-1">
              {allNavItems.map((item, i) => {
                const isActive = item.path === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.path.replace(/\/upcoming$/, '')) || pathname === item.path
                return (
                  <Link
                    key={item.moduleId}
                    href={item.path}
                    onClick={closeMobileMenu}
                    className={`block py-4 text-2xl font-light transition-all duration-300 ${
                      isActive ? 'text-white' : 'text-white/70 active:opacity-70'
                    }`}
                    style={{
                      opacity: mobileMenuAnimating ? 0.9 : 0,
                      transform: mobileMenuAnimating ? 'translateY(0)' : 'translateY(12px)',
                      transitionDelay: mobileMenuAnimating ? `${100 + i * 60}ms` : '0ms',
                    }}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>

            {/* User section — pushed to bottom */}
            <div
              className="mt-auto pt-6 pb-10 border-t border-white/10"
              style={{
                opacity: mobileMenuAnimating ? 1 : 0,
                transitionProperty: 'opacity',
                transitionDuration: '0.4s',
                transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
                transitionDelay: mobileMenuAnimating ? '400ms' : '0ms',
              }}
            >
              {isLoading ? null : user ? (
                <div className="space-y-1">
                  {/* User info */}
                  <div className="flex items-center gap-3 mb-5">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-medium overflow-hidden flex-shrink-0"
                      style={{ backgroundColor: userProfile?.avatarUrl ? undefined : brandConfig.primaryColor, color: isLightColor(brandConfig.primaryColor) ? '#000000' : '#ffffff' }}
                    >
                      {userProfile?.avatarUrl ? (
                        <img src={userProfile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                      ) : (
                        avatarInitial
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-base font-medium truncate">{displayName}</p>
                      <p className="text-white/40 text-sm truncate">{user.email}</p>
                    </div>
                  </div>

                  <Link
                    href="/profile"
                    onClick={closeMobileMenu}
                    className="flex items-center gap-3 py-3 text-lg text-white/70 active:opacity-70 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    Edit Profile
                  </Link>

                  <button
                    onClick={handleSignOut}
                    className="flex items-center gap-3 w-full py-3 text-lg text-white/70 active:opacity-70 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    Sign Out
                  </button>
                </div>
              ) : !isOnSignInPage ? (
                <Link
                  href={`/sign-in?redirectTo=${encodeURIComponent(pathname)}`}
                  onClick={closeMobileMenu}
                  className="flex items-center gap-3 py-3 text-lg text-white/70 active:opacity-70 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
                  Sign In
                </Link>
              ) : null}
            </div>
          </nav>
        </div>
      )}
    </>
  )
}
