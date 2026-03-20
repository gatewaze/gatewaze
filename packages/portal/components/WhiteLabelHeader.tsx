'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { getClientBrandConfig, isLightColor } from '@/config/brand'
import type { BrandConfig } from '@/config/brand'

interface WhiteLabelEvent {
  event_title: string
  event_logo: string | null
}

interface Props {
  event: WhiteLabelEvent | null
  brandConfig: BrandConfig
}

interface UserProfile {
  firstName: string
  avatarUrl: string | null
}

export function WhiteLabelHeader({ brandConfig }: Props) {
  const { user, session, isLoading, signOut } = useAuth()
  const pathname = usePathname()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [profileRefreshKey, setProfileRefreshKey] = useState(0)

  const isOnSignInPage = pathname === '/sign-in'

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Listen for profile updates (e.g., after enrichment or profile save)
  useEffect(() => {
    const handler = () => setProfileRefreshKey(k => k + 1)
    window.addEventListener('user-profile-updated', handler)
    return () => window.removeEventListener('user-profile-updated', handler)
  }, [])

  // Fetch user profile when authenticated or when profile is updated
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
  }

  const displayName = userProfile?.firstName || user?.email?.split('@')[0] || '?'
  const avatarInitial = (userProfile?.firstName || user?.email || '?').charAt(0).toUpperCase()

  return (
    <header className="relative z-50">
      <div className="flex items-center justify-between p-4">
        {/* Spacer — no logo/title on custom domains (already shown on page) */}
        <div />

        {/* Auth Navigation */}
        <nav className="flex items-center gap-4">
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
                  style={{ backgroundColor: userProfile?.avatarUrl ? undefined : brandConfig.primaryColor, color: userProfile?.avatarUrl ? undefined : (isLightColor(brandConfig.primaryColor) ? '#000000' : '#ffffff') }}
                >
                  {userProfile?.avatarUrl ? (
                    <img
                      src={userProfile.avatarUrl}
                      alt={displayName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    avatarInitial
                  )}
                </div>
                <span className="hidden sm:inline pr-1">{displayName}</span>
                <svg
                  className={`w-4 h-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
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
                    <Link
                      href="/profile"
                      onClick={() => setIsMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Profile
                    </Link>
                  </div>

                  <div className="border-t border-white/10 py-1">
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-3 w-full px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
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
      </div>
    </header>
  )
}
