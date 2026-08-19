'use client'

import { createContext, useContext, useMemo, useState, useEffect, useRef, useCallback } from 'react'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import type { RecommendedEvent } from '@/app/(main)/events/[identifier]/(portal)/layout'
import { useEventUserState } from '@/hooks/useEventUserState'
import type { EventUserState } from '@/hooks/useEventUserState'
import { useAuth } from '@/hooks/useAuth'
import { isOnCustomDomain } from '@/lib/customDomain'
import { computeRegisterTarget, useExternalRegisterHandler, checkCurrentPersonIsMember } from './useEventRegister'
import { MembersOnlyRegisterModal } from './MembersOnlyRegisterModal'

interface EventContextValue {
  event: Event & { id: string }
  brandConfig: BrandConfig
  eventIdentifier: string
  /** Base path for event links: `/events/{id}` on main domain, `''` on custom domains */
  basePath: string
  primaryColor: string
  secondaryColor: string
  useDarkText: boolean
  speakerCount: number
  sponsorCount: number
  competitionCount: number
  discountCount: number
  mediaCount: number
  recommendedEvent?: RecommendedEvent | null
  userState: EventUserState
  /** Enabled module ids/features — needed to render the sign-in:providers slot. */
  enabledModuleIds: string[]
  enabledFeatures: string[]
  /** True when this event's registration is gated to members. */
  registrationMembersOnly: boolean
  /**
   * Entry point for the register CTA. For a members-only event it checks
   * membership and either proceeds (signed-in member) or opens the members-only
   * modal; for an open event it navigates as before. Buttons call this instead
   * of linking directly when the event is members-only.
   */
  requestRegister: () => void
  theme: {
    textColor: string
    textMutedColor: string
    headingColor: string
    linkColor: string
    panelBg: string
    panelBorder: string
  }
}

const EventContext = createContext<EventContextValue | null>(null)

interface Props {
  event: Event & { id: string }
  brandConfig: BrandConfig
  eventIdentifier: string
  speakerCount: number
  sponsorCount: number
  competitionCount: number
  discountCount: number
  mediaCount: number
  recommendedEvent?: RecommendedEvent | null
  useDarkText: boolean
  enabledModuleIds?: string[]
  enabledFeatures?: string[]
  children: React.ReactNode
}

export function EventProvider({ event, brandConfig, eventIdentifier, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, recommendedEvent, useDarkText, enabledModuleIds = [], enabledFeatures = [], children }: Props) {
  // Always use brand primary color for buttons and UI accents
  const primaryColor = brandConfig.primaryColor
  const secondaryColor = brandConfig.secondaryColor
  const userState = useEventUserState(event)
  const basePath = useMemo(() => isOnCustomDomain() ? '' : `/events/${eventIdentifier}`, [eventIdentifier])

  // ---- Members-only registration gate -------------------------------------
  // Single instance for the whole event page (avoids double modals from the
  // duplicated desktop/mobile register buttons). Buttons call requestRegister().
  const { user, isLoading: authLoading } = useAuth()
  const registrationMembersOnly = !!event.registration_members_only
  const [membersModalOpen, setMembersModalOpen] = useState(false)
  const externalRegister = useExternalRegisterHandler(event)
  const registerTarget = useMemo(() => computeRegisterTarget(event, basePath), [event, basePath])

  const proceedToRegister = useCallback(() => {
    if (registerTarget.useExternalLink) {
      void externalRegister()
    } else if (registerTarget.registerHref) {
      window.location.href = registerTarget.registerHref
    }
  }, [registerTarget, externalRegister])

  const requestRegister = useCallback(async () => {
    if (!registrationMembersOnly) { proceedToRegister(); return }
    if (!user) { setMembersModalOpen(true); return }
    // Signed in — allow through only if they're actually a member.
    const isMember = await checkCurrentPersonIsMember()
    if (isMember) proceedToRegister()
    else setMembersModalOpen(true)
  }, [registrationMembersOnly, user, proceedToRegister])

  // Resume after the LFID sign-in flow returns to the event page with
  // ?register=1. Runs once, client-side; reads window.location directly (rather
  // than useSearchParams) so EventProvider doesn't need a Suspense boundary and
  // the page isn't forced into client-side rendering. Strips the param so a
  // manual refresh doesn't re-fire.
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (autoRanRef.current) return
    if (authLoading) return
    let hasRegisterParam = false
    try { hasRegisterParam = new URLSearchParams(window.location.search).get('register') === '1' } catch { /* ignore */ }
    if (!hasRegisterParam) return
    autoRanRef.current = true
    void requestRegister()
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('register')
      window.history.replaceState({}, '', url.toString())
    } catch { /* ignore */ }
  }, [authLoading, requestRegister])

  // Return the browser to this event page after sign-in, then auto-resume.
  const registerReturnPath = `${basePath || '/'}?register=1`

  const theme = useMemo(() => ({
    textColor: useDarkText ? '#1f2937' : '#ffffff',
    textMutedColor: useDarkText ? '#374151' : 'rgba(255,255,255,0.85)',
    headingColor: useDarkText ? '#111827' : '#ffffff',
    linkColor: useDarkText ? '#2563eb' : '#93c5fd',
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
  }), [useDarkText])

  const value = useMemo(() => ({
    event,
    brandConfig,
    eventIdentifier,
    basePath,
    primaryColor,
    secondaryColor,
    useDarkText,
    speakerCount,
    sponsorCount,
    competitionCount,
    discountCount,
    mediaCount,
    recommendedEvent,
    userState,
    enabledModuleIds,
    enabledFeatures,
    registrationMembersOnly,
    requestRegister,
    theme,
  }), [event, brandConfig, eventIdentifier, basePath, primaryColor, secondaryColor, useDarkText, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, recommendedEvent, userState, enabledModuleIds, enabledFeatures, registrationMembersOnly, requestRegister, theme])

  return (
    <EventContext.Provider value={value}>
      {children}
      {registrationMembersOnly && (
        <MembersOnlyRegisterModal
          open={membersModalOpen}
          onClose={() => setMembersModalOpen(false)}
          eventTitle={event.event_title}
          membershipUrl={brandConfig.membershipUrl}
          primaryColor={primaryColor}
          isSignedIn={!!user}
          redirectTo={registerReturnPath}
          enabledModuleIds={enabledModuleIds}
          enabledFeatures={enabledFeatures}
        />
      )}
    </EventContext.Provider>
  )
}

export function useEventContext() {
  const context = useContext(EventContext)
  if (!context) {
    throw new Error('useEventContext must be used within an EventProvider')
  }
  return context
}
