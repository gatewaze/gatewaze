'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense, useMemo, useState, useRef, useEffect, useCallback } from 'react'
import type { Event } from '@/types/event'
import { useRegistrationStatus } from '@/hooks/useRegistrationStatus'
import { GlowBorder } from '@/components/ui/GlowBorder'
import { PortalButton } from '@/components/ui/PortalButton'
import { CLICK_ID_PARAMS } from '@/config/platforms'
import { createTrackingSession, captureTrackingParams, markSessionRedirected } from '@/lib/tracking'
import { hasConsentFor } from '@/hooks/useConsent'
import type { EventUserState } from '@/hooks/useEventUserState'
import { isOnCustomDomain } from '@/lib/customDomain'
import { isLightColor } from '@/config/brand'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  show: boolean
}

interface Props {
  event: Event
  eventIdentifier: string
  useDarkText: boolean
  primaryColor: string
  speakerCount: number
  sponsorCount: number
  competitionCount: number
  discountCount: number
  mediaCount: number
  userState?: EventUserState
}

function useHasInviteToken() {
  const [hasToken, setHasToken] = useState(false)
  useEffect(() => {
    setHasToken(!!localStorage.getItem('invite_short_code'))
  }, [])
  return hasToken
}

function useNavItems(event: Event, basePath: string, speakerCount: number, sponsorCount: number, competitionCount: number, discountCount: number, mediaCount: number, userState?: EventUserState) {
  const hasInvite = useHasInviteToken()

  const navItems: NavItem[] = [
    {
      label: 'Details',
      href: basePath || '/',
      show: true,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Speakers',
      href: `${basePath}/speakers`,
      show: speakerCount > 0,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      label: 'Sponsors',
      href: `${basePath}/sponsors`,
      show: sponsorCount > 0,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      label: 'Agenda',
      href: `${basePath}/agenda`,
      show: event.enable_agenda ?? false,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      label: 'Venue',
      href: `${basePath}/venue`,
      show: !!(event.venue_content),
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
      ),
    },
    {
      label: event.addedpage_title || 'Workshops',
      href: `${basePath}/${(event.addedpage_title || 'Workshops').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')}`,
      show: !!(event.addedpage_content),
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      ),
    },
    {
      label: competitionCount === 1 ? 'Competition' : 'Competitions',
      href: `${basePath}/competitions`,
      show: competitionCount > 1,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-3.77 1.522m0 0a6.003 6.003 0 01-3.77-1.522" />
        </svg>
      ),
    },
    {
      label: discountCount === 1 ? 'Discount' : 'Discounts',
      href: `${basePath}/discounts`,
      show: discountCount > 0,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
        </svg>
      ),
    },
    {
      label: 'Media',
      href: `${basePath}/media`,
      show: mediaCount > 0,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
        </svg>
      ),
    },
    {
      label: userState?.hasTalkSubmission ? 'My talk' : 'Submit a talk',
      href: `${basePath}/talks`,
      show: (event.enable_call_for_speakers ?? false) || (userState?.hasTalkSubmission ?? false),
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      ),
    },
    {
      label: 'RSVP',
      href: `${basePath}/rsvp`,
      show: hasInvite,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      ),
    },
  ]

  return navItems.filter(item => item.show)
}

function useRegisterLink(event: Event, basePath: string) {
  const now = new Date()
  const eventEndDate = event.event_end ? new Date(event.event_end) : new Date(event.event_start)
  const isPastEvent = eventEndDate < now

  const showRegisterButton = (event.enable_registration ?? false) && !isPastEvent
  const useExternalLink = !event.enable_native_registration && event.event_link
  const registerHref = useExternalLink
    ? event.event_link
    : `${basePath}/register`

  return { showRegisterButton, useExternalLink, registerHref }
}

/**
 * Build a tracked external URL from stored sessionStorage tracking params.
 * Creates a tracking session and encodes the session ID into UTM params.
 */
function useExternalRegisterHandler(event: Event) {
  return useCallback(async () => {
    if (!event.event_link) return

    // Read stored tracking params from sessionStorage
    let storedParams: { clickIds: Record<string, string>; utmParams: Record<string, string> } | null = null
    try {
      const raw = sessionStorage.getItem('tracking_params')
      if (raw) storedParams = JSON.parse(raw)
    } catch { /* ignore */ }

    // Create tracking session from stored params if consent given
    let sessionId: string | null = null
    if (storedParams && hasConsentFor('marketing')) {
      const searchParams = new URLSearchParams()
      for (const [k, v] of Object.entries(storedParams.clickIds)) searchParams.set(k, v)
      for (const [k, v] of Object.entries(storedParams.utmParams)) searchParams.set(k, v)
      const trackingParams = captureTrackingParams(searchParams)
      const newSession = await createTrackingSession({
        eventId: event.event_id,
        trackingParams,
        hasConsent: true,
      })
      if (newSession) {
        sessionId = newSession.sessionId
        await markSessionRedirected(sessionId)
      }
    }

    // Build redirect URL with tracking params encoded
    const url = new URL(event.event_link)
    if (storedParams) {
      const platform = Object.entries(CLICK_ID_PARAMS).find(([, param]) => storedParams!.clickIds[param])?.[0]
      if (sessionId && platform) {
        url.searchParams.set('utm_source', `${platform}__${sessionId}`)
      } else if (sessionId) {
        url.searchParams.set('utm_source', `direct__${sessionId}`)
      } else if (storedParams.utmParams.utm_source) {
        url.searchParams.set('utm_source', storedParams.utmParams.utm_source)
      }
      if (storedParams.utmParams.utm_medium) url.searchParams.set('utm_medium', storedParams.utmParams.utm_medium)
      if (storedParams.utmParams.utm_campaign) url.searchParams.set('utm_campaign', storedParams.utmParams.utm_campaign)
      if (sessionId) {
        url.searchParams.set('utm_content', sessionId)
      } else if (storedParams.utmParams.utm_content) {
        url.searchParams.set('utm_content', storedParams.utmParams.utm_content)
      }
      if (storedParams.utmParams.utm_term) url.searchParams.set('utm_term', storedParams.utmParams.utm_term)
    }

    window.location.href = url.toString()
  }, [event.event_link, event.event_id])
}


/**
 * Mobile action bar shown in the hero section on small screens.
 * Renders the register button and a hamburger menu side by side.
 */
export function EventMobileActions(props: Props) {
  return (
    <Suspense fallback={null}>
      <EventMobileActionsInner {...props} />
    </Suspense>
  )
}

function EventMobileActionsInner({ event, eventIdentifier, useDarkText, primaryColor, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, userState }: Props) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const customDomain = isOnCustomDomain()
  const basePath = customDomain ? '' : `/events/${eventIdentifier}`
  const visibleItems = useNavItems(event, basePath, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, userState)
  const { showRegisterButton, useExternalLink, registerHref } = useRegisterLink(event, basePath)
  const handleExternalRegister = useExternalRegisterHandler(event)
  const { isRegistered: realIsRegistered } = useRegistrationStatus(event)
  const isConfirmedSpeaker = userState?.isConfirmedSpeaker ?? false
  const isLive = userState?.timeline === 'live'

  // Hide register button on competition/discount pages to keep focus on those CTAs
  const isCompOrDiscPage = pathname.endsWith('/competitions') || pathname.endsWith('/discounts')

  // Query string overrides for testing
  const simulateRegistered = searchParams.get('simulateRegistered')
  const isRegistered = simulateRegistered !== null ? simulateRegistered === 'true' : realIsRegistered
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const theme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    hoverBgColor: useDarkText ? 'rgba(17, 24, 39, 0.1)' : 'rgba(255, 255, 255, 0.1)',
    activeBgColor: useDarkText ? 'rgba(17, 24, 39, 0.15)' : 'rgba(255, 255, 255, 0.2)',
    iconBg: useDarkText ? 'bg-gray-900/10' : 'bg-white/20',
  }), [useDarkText])

  const isActive = (href: string) => {
    const detailsHref = basePath || '/'
    if (href === detailsHref) {
      return pathname === detailsHref || pathname === `${basePath}/`
    }
    return pathname.startsWith(href)
  }

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  // Close menu on navigation
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  return (
    <div className="lg:hidden pb-6" ref={menuRef}>
      {/* Button row: register/status + hamburger */}
      <div className="flex items-center gap-3">
        {showRegisterButton && !isRegistered && !isConfirmedSpeaker && !isCompOrDiscPage && (
          <PortalButton
            variant="primary"
            primaryColor={primaryColor}
            href={useExternalLink ? undefined : registerHref!}
            onClick={useExternalLink ? handleExternalRegister : undefined}
            glow
            className="flex-1 justify-center"
          >
            {event.register_button_text || 'Register now'}
          </PortalButton>
        )}

        {isConfirmedSpeaker && (
          <div className={`flex-1 flex items-center gap-3 px-4 h-12 rounded-xl backdrop-blur-[10px] ${
            useDarkText ? 'bg-gray-900/15 border border-gray-700/50' : 'bg-white/15 border border-white/20'
          }`}>
            <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <span className={`text-sm font-medium ${useDarkText ? 'text-gray-900' : 'text-white'}`}>
              You're speaking
            </span>
          </div>
        )}

        {!isConfirmedSpeaker && isRegistered && (() => {
          const slug = event.gradual_eventslug
          if (slug) {
            const portalDomain = process.env.NEXT_PUBLIC_PORTAL_DOMAIN
            const eventUrl = `https://${portalDomain}/public/events/${slug}`
            const joinUrl = `https://${portalDomain}/login?event=${slug}&returnTo=${encodeURIComponent(eventUrl)}&type=event`
            return (
              <PortalButton
                variant="primary"
                primaryColor={primaryColor}
                href={joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                glow
                className="flex-1 justify-center"
              >
                Join event
              </PortalButton>
            )
          }
          return (
            <div className={`flex-1 flex items-center gap-3 px-4 h-12 rounded-xl backdrop-blur-[10px] ${
              useDarkText ? 'bg-gray-900/15 border border-gray-700/50' : 'bg-white/15 border border-white/20'
            }`}>
              <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className={`text-sm font-medium ${useDarkText ? 'text-gray-900' : 'text-white'}`}>
                You're registered
              </span>
            </div>
          )
        })()}

        {isLive && (
          <div className={`flex items-center gap-2 px-3 h-12 rounded-xl backdrop-blur-[10px] ${
            useDarkText ? 'bg-gray-900/15 border border-gray-700/50' : 'bg-white/15 border border-white/20'
          }`}>
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
            <span className={`text-xs font-bold uppercase tracking-wider ${useDarkText ? 'text-gray-900' : 'text-white'}`}>Live</span>
          </div>
        )}

        <button
          onClick={() => setMenuOpen(prev => !prev)}
          className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer backdrop-blur-[10px] transition-colors duration-200 ${
            useDarkText
              ? 'bg-gray-900/15 border border-gray-700/50'
              : 'bg-white/15 border border-white/20'
          }`}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          <div className="w-5 h-4 relative flex flex-col justify-between">
            <span
              className="block w-full h-0.5 rounded-full transition-all duration-300"
              style={{
                backgroundColor: useDarkText ? '#111827' : '#ffffff',
                transform: menuOpen ? 'translateY(7px) rotate(45deg)' : 'none',
                transformOrigin: 'center',
              }}
            />
            <span
              className="block w-full h-0.5 rounded-full transition-all duration-300"
              style={{
                backgroundColor: useDarkText ? '#111827' : '#ffffff',
                opacity: menuOpen ? 0 : 1,
                transform: menuOpen ? 'scaleX(0)' : 'none',
                transformOrigin: 'center',
              }}
            />
            <span
              className="block w-full h-0.5 rounded-full transition-all duration-300"
              style={{
                backgroundColor: useDarkText ? '#111827' : '#ffffff',
                transform: menuOpen ? 'translateY(-7px) rotate(-45deg)' : 'none',
                transformOrigin: 'center',
              }}
            />
          </div>
        </button>
      </div>

      {/* Dropdown menu */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          menuOpen ? 'max-h-96 opacity-100 mt-3' : 'max-h-0 opacity-0 mt-0'
        }`}
      >
        <GlowBorder useDarkTheme={useDarkText}>
          <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder}`}>
            <nav className="p-2 flex flex-col gap-2">
              {visibleItems.map((item) => {
                const active = isActive(item.href)
                const isHovered = hoveredItem === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 pr-3 rounded-xl cursor-pointer"
                    style={{
                      backgroundColor: active
                        ? theme.activeBgColor
                        : isHovered
                          ? theme.hoverBgColor
                          : 'transparent',
                      transition: 'background-color 200ms ease-out',
                    }}
                    onMouseEnter={() => setHoveredItem(item.href)}
                    onMouseLeave={() => setHoveredItem(null)}
                    onClick={() => setMenuOpen(false)}
                  >
                    <div
                      className={`flex-shrink-0 w-11 h-11 ${active ? 'rounded-l-xl' : 'rounded-xl'} flex items-center justify-center ${active ? '' : theme.iconBg}`}
                      style={{
                        backgroundColor: active ? primaryColor : undefined,
                        transition: 'background-color 200ms ease-out',
                      }}
                    >
                      <span
                        className={active ? 'text-white' : ''}
                        style={active ? undefined : { color: useDarkText ? '#374151' : 'rgba(255,255,255,0.8)' }}
                      >
                        {item.icon}
                      </span>
                    </div>
                    <span className="text-base font-medium text-white">
                      {item.label}
                    </span>
                  </Link>
                )
              })}
            </nav>
          </div>
        </GlowBorder>
      </div>
    </div>
  )
}

/**
 * Desktop sidebar shown in the left column on large screens.
 */
export function EventSidebar(props: Props) {
  return (
    <Suspense fallback={null}>
      <EventSidebarInner {...props} />
    </Suspense>
  )
}

function EventSidebarInner({ event, eventIdentifier, useDarkText, primaryColor, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, userState }: Props) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const customDomain = isOnCustomDomain()
  const basePath = customDomain ? '' : `/events/${eventIdentifier}`
  const visibleItems = useNavItems(event, basePath, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, userState)
  const { showRegisterButton, useExternalLink, registerHref } = useRegisterLink(event, basePath)
  const handleExternalRegister = useExternalRegisterHandler(event)
  const { isRegistered: realIsRegistered } = useRegistrationStatus(event)
  const isConfirmedSpeaker = userState?.isConfirmedSpeaker ?? false
  const isLive = userState?.timeline === 'live'

  // Hide register button on competition/discount pages to keep focus on those CTAs
  const isCompOrDiscPage = pathname.endsWith('/competitions') || pathname.endsWith('/discounts')

  // Query string overrides for testing
  const simulateRegistered = searchParams.get('simulateRegistered')
  const isRegistered = simulateRegistered !== null ? simulateRegistered === 'true' : realIsRegistered

  const theme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    hoverBgColor: useDarkText ? 'rgba(17, 24, 39, 0.1)' : 'rgba(255, 255, 255, 0.1)',
    activeBgColor: useDarkText ? 'rgba(17, 24, 39, 0.15)' : 'rgba(255, 255, 255, 0.2)',
    iconBg: useDarkText ? 'bg-gray-900/10' : 'bg-white/20',
  }), [useDarkText])

  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  const isActive = (href: string) => {
    const detailsHref = basePath || '/'
    if (href === detailsHref) {
      return pathname === detailsHref || pathname === `${basePath}/`
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="w-[320px] flex-shrink-0 space-y-4">
      {showRegisterButton && !isRegistered && !isConfirmedSpeaker && !isCompOrDiscPage && (
        <PortalButton
          variant="primary"
          primaryColor={primaryColor}
          href={useExternalLink ? undefined : registerHref!}
          onClick={useExternalLink ? handleExternalRegister : undefined}
          glow
          className="w-full justify-center"
        >
          {event.register_button_text || 'Register now'}
        </PortalButton>
      )}

      {isConfirmedSpeaker && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl backdrop-blur-[10px] ${
          useDarkText ? 'bg-gray-900/15 border border-gray-700/50' : 'bg-white/15 border border-white/20'
        }`}>
          <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <span className={`text-sm font-medium ${useDarkText ? 'text-gray-900' : 'text-white'}`}>
              You're speaking
            </span>
            {userState?.talkTitle && (
              <p className={`text-xs truncate max-w-[200px] ${useDarkText ? 'text-gray-600' : 'text-white/60'}`}>
                {userState.talkTitle}
              </p>
            )}
          </div>
        </div>
      )}

      {!isConfirmedSpeaker && isRegistered && (() => {
        const slug = event.gradual_eventslug
        if (slug) {
          const portalDomain = process.env.NEXT_PUBLIC_PORTAL_DOMAIN
          const eventUrl = `https://${portalDomain}/public/events/${slug}`
          const joinUrl = `https://${portalDomain}/login?event=${slug}&returnTo=${encodeURIComponent(eventUrl)}&type=event`
          return (
            <PortalButton
              variant="primary"
              primaryColor={primaryColor}
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              glow
              className="w-full justify-center"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Join event
            </PortalButton>
          )
        }
        return (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl backdrop-blur-[10px] ${
            useDarkText ? 'bg-gray-900/15 border border-gray-700/50' : 'bg-white/15 border border-white/20'
          }`}>
            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor, color: isLightColor(primaryColor) ? '#000000' : '#ffffff' }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className={`text-sm font-medium ${useDarkText ? 'text-gray-900' : 'text-white'}`}>
              You're registered
            </span>
          </div>
        )
      })()}

      {isLive && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl backdrop-blur-[10px] ${
          useDarkText ? 'bg-gray-900/15 border border-gray-700/50' : 'bg-white/15 border border-white/20'
        }`}>
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <span className={`text-sm font-bold uppercase tracking-wider ${useDarkText ? 'text-gray-900' : 'text-white'}`}>
            Happening Now
          </span>
        </div>
      )}

      <GlowBorder useDarkTheme={useDarkText}>
        <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder}`}>
          <nav className="p-2 flex flex-col gap-2">
            {visibleItems.map((item) => {
              const active = isActive(item.href)
              const isHovered = hoveredItem === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 pr-3 rounded-xl cursor-pointer"
                  style={{
                    backgroundColor: active
                      ? theme.activeBgColor
                      : isHovered
                        ? theme.hoverBgColor
                        : 'transparent',
                    transition: 'background-color 200ms ease-out',
                  }}
                  onMouseEnter={() => setHoveredItem(item.href)}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  <div
                    className={`flex-shrink-0 w-11 h-11 ${active ? 'rounded-l-xl' : 'rounded-xl'} flex items-center justify-center ${active ? '' : theme.iconBg}`}
                    style={{
                      backgroundColor: active ? primaryColor : undefined,
                      transition: 'background-color 200ms ease-out',
                    }}
                  >
                    <span
                      className=""
                      style={active ? { color: isLightColor(primaryColor) ? '#000000' : '#ffffff' } : { color: useDarkText ? '#374151' : 'rgba(255,255,255,0.8)' }}
                    >
                      {item.icon}
                    </span>
                  </div>
                  <span className="text-base font-medium text-white">
                    {item.label}
                  </span>
                </Link>
              )
            })}
          </nav>
        </div>
      </GlowBorder>
    </div>
  )
}
