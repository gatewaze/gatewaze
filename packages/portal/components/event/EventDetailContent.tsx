'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useConsent } from '@/hooks/useConsent'
import { useTrackingCapture } from '@/hooks/useTrackingCapture'
import { markSessionRedirected } from '@/lib/tracking'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { RegistrationForm } from './RegistrationForm'
import { EventHero, shouldUseDarkText } from './EventHero'
import { EventContent } from './EventContent'
import { GlowBorder } from '@/components/ui/GlowBorder'

// Dynamic import with SSR disabled for WebGL component
const GradientBackground = dynamic(
  () => import('@/components/ui/GradientBackground').then((mod) => mod.GradientBackground),
  { ssr: false }
)

interface Props {
  event: Event
  brandConfig: BrandConfig
}

export function EventDetailContent({ event, brandConfig }: Props) {
  const [showRegistrationForm, setShowRegistrationForm] = useState(false)
  const { categories } = useConsent()

  // Capture tracking if marketing consent given
  const { session } = useTrackingCapture({
    eventId: event.event_id,
    hasConsent: categories.marketing,
  })

  // Handle register button click
  const handleRegister = async () => {
    // If native registration is enabled, show the form
    if (event.enable_native_registration) {
      setShowRegistrationForm(true)
      return
    }

    // Otherwise, redirect to external registration link
    if (!event.event_link) return

    // Mark session as redirected if we have one
    if (session) {
      await markSessionRedirected(session.sessionId)
    }

    // Redirect to external registration
    window.location.href = event.event_link
  }

  // Handle successful registration
  const handleRegistrationSuccess = () => {
    // Form shows its own success state, nothing to do here
  }

  // Handle cancel registration
  const handleRegistrationCancel = () => {
    setShowRegistrationForm(false)
  }

  // Use event's gradient colors as primary/secondary, falling back to brand colors
  const primaryColor = event.gradient_color_1 || brandConfig.primaryColor
  const secondaryColor = event.gradient_color_2 || brandConfig.secondaryColor

  // Determine if we need dark text (for light backgrounds)
  const useDarkText = useMemo(
    () => shouldUseDarkText(primaryColor, secondaryColor),
    [primaryColor, secondaryColor]
  )

  // Theme colors based on background luminance
  const theme = useMemo(() => ({
    panelBg: useDarkText ? 'bg-gray-900/15' : 'bg-white/15',
    panelTextMuted: useDarkText ? 'text-gray-300' : 'text-gray-500',
    panelBorder: useDarkText ? 'border border-gray-700/50' : 'border border-white/20',
    buttonText: useDarkText ? 'text-white' : 'text-white',
  }), [useDarkText])

  // Set event primary color for cookie consent banner (client-side only to avoid hydration mismatch)
  useEffect(() => {
    document.documentElement.dataset.eventPrimaryColor = primaryColor
    return () => {
      delete document.documentElement.dataset.eventPrimaryColor
    }
  }, [primaryColor])

  return (
    <div className="min-h-screen" style={{ backgroundColor: secondaryColor }}>
      {/* CSS Gradient fallback + WebGL Gradient - fixed to cover entire viewport including header */}
      <div
        className="fixed inset-0 h-screen overflow-hidden pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 100% 100% at 100% 100%, ${primaryColor} 0%, transparent 80%),
                       radial-gradient(ellipse 80% 80% at 0% 0%, ${secondaryColor} 0%, transparent 70%),
                       linear-gradient(135deg, ${secondaryColor} 0%, ${primaryColor}60 100%),
                       ${secondaryColor}`,
        }}
      >
        <GradientBackground
          color1={primaryColor}
          color2={secondaryColor}
          color3={event.gradient_color_3 || '#1e2837'}
        />
      </div>

      {/* Main Content */}
      <main className="relative z-10">
        <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8">
          {/* Hero Section */}
          <EventHero event={event} brandConfig={brandConfig} useDarkText={useDarkText} />

          {/* Two-column layout: Sidebar + Content */}
          <div className="flex flex-col lg:flex-row gap-6 lg:gap-12 pb-12">
            {/* Left Sidebar - Action Buttons (matches screenshot width) */}
            <div className="order-2 lg:order-1 w-full lg:w-[320px] flex-shrink-0 space-y-4">
              {/* Registration Panel */}
              {event.enable_registration && (
                <GlowBorder useDarkTheme={useDarkText}>
                  <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-5`}>
                    {showRegistrationForm && event.enable_native_registration ? (
                      <RegistrationForm
                        event={event}
                        brandConfig={brandConfig}
                        onSuccess={handleRegistrationSuccess}
                        onCancel={handleRegistrationCancel}
                        trackingSessionId={session?.sessionId}
                        useDarkTheme={useDarkText}
                      />
                    ) : (
                      <button
                        onClick={handleRegister}
                        className={`w-full px-6 py-3.5 text-base font-semibold ${theme.buttonText} rounded-xl hover:shadow-lg hover:brightness-110 transition-all duration-200 transform hover:scale-[1.02] cursor-pointer`}
                        style={{
                          backgroundColor: primaryColor,
                          borderColor: primaryColor,
                          borderWidth: '2px',
                          borderStyle: 'solid',
                          boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.5), 0 10px 15px -3px rgba(0, 0, 0, 0.1)`,
                        }}
                      >
                        {event.register_button_text || 'Register now'}
                      </button>
                    )}
                  </div>
                </GlowBorder>
              )}

              {/* Registration closed message */}
              {!event.enable_registration && (
                <GlowBorder useDarkTheme={useDarkText}>
                  <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-5`}>
                    <p className={`text-sm font-medium text-center ${theme.panelTextMuted}`}>
                      Registration is currently closed for this event.
                    </p>
                  </div>
                </GlowBorder>
              )}

              {/* Call for Speakers Panel */}
              {event.enable_call_for_speakers && (
                <GlowBorder useDarkTheme={useDarkText}>
                  <div className={`${theme.panelBg} backdrop-blur-[10px] rounded-2xl overflow-hidden ${theme.panelBorder} p-5`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                          useDarkText ? 'bg-gray-900/10' : 'bg-white/20'
                        }`}
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          style={{ color: useDarkText ? '#374151' : 'rgba(255,255,255,0.8)' }}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                          />
                        </svg>
                      </div>
                      <div>
                        <h3 className={`text-sm font-semibold ${useDarkText ? 'text-gray-900' : 'text-white'}`}>
                          Call for Speakers
                        </h3>
                        <p className={`text-xs ${theme.panelTextMuted}`}>
                          Share your expertise
                        </p>
                      </div>
                    </div>
                    <a
                      href={`/events/${event.event_slug || event.event_id}/speakers`}
                      className="block w-full px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 border-2 hover:scale-[1.02] text-center cursor-pointer"
                      style={{
                        borderColor: primaryColor,
                        color: primaryColor,
                        backgroundColor: 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = primaryColor
                        e.currentTarget.style.color = '#ffffff'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent'
                        e.currentTarget.style.color = primaryColor
                      }}
                    >
                      Submit a talk
                    </a>
                  </div>
                </GlowBorder>
              )}
            </div>

            {/* Right Content - Page Content */}
            <div className="order-1 lg:order-2 flex-1 min-w-0">
              <EventContent event={event} useDarkText={useDarkText} />
            </div>
          </div>
        </div>
      </main>

    </div>
  )
}
