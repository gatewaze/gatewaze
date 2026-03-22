'use client'

import { createContext, useContext, useMemo } from 'react'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import type { RecommendedEvent } from '@/app/(main)/events/[identifier]/(portal)/layout'
import { useEventUserState } from '@/hooks/useEventUserState'
import type { EventUserState } from '@/hooks/useEventUserState'

interface EventContextValue {
  event: Event & { id: string }
  brandConfig: BrandConfig
  eventIdentifier: string
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
  children: React.ReactNode
}

export function EventProvider({ event, brandConfig, eventIdentifier, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, recommendedEvent, useDarkText, children }: Props) {
  const primaryColor = event.gradient_color_1 || brandConfig.primaryColor
  const secondaryColor = event.gradient_color_2 || brandConfig.secondaryColor
  const userState = useEventUserState(event)

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
    theme,
  }), [event, brandConfig, eventIdentifier, primaryColor, secondaryColor, useDarkText, speakerCount, sponsorCount, competitionCount, discountCount, mediaCount, recommendedEvent, userState, theme])

  return (
    <EventContext.Provider value={value}>
      {children}
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
