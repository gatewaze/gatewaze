'use client'

import { useConsent } from '@/hooks/useConsent'
import { useTrackingCapture } from '@/hooks/useTrackingCapture'
import { markSessionRedirected } from '@/lib/tracking'
import type { Event } from '@/types/event'
import type { BrandConfig } from '@/config/brand'
import { stripEmojis } from '@/lib/text'

interface Props {
  event: Event
  brandConfig: BrandConfig
  identifier: string
}

export function RegisterPageClient({ event, brandConfig }: Props) {
  const { categories } = useConsent()

  // Capture tracking if marketing consent given
  const { session } = useTrackingCapture({
    eventId: event.event_id,
    hasConsent: categories.marketing,
  })

  // Handle register button click
  const handleRegister = async () => {
    if (!event.event_link) return

    // Mark session as redirected if we have one
    if (session) {
      await markSessionRedirected(session.sessionId)
    }

    // Redirect to external registration
    window.location.href = event.event_link
  }

  // Format date for display
  const formatDate = (dateStr: string, timezone: string | null) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: timezone || 'UTC',
      })
    } catch {
      return dateStr
    }
  }

  const formatTime = (dateStr: string, timezone: string | null) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone: timezone || 'UTC',
      })
    } catch {
      return ''
    }
  }

  return (
    <div className="pub-side-card" style={{ overflow: 'hidden', padding: 0 }}>
      <div style={{ padding: '24px' }}>
        <h1 style={{ font: '600 28px var(--font-display)', color: 'var(--ink)', letterSpacing: '-0.02em', margin: '0 0 6px' }}>Register for Event</h1>
        <h2 style={{ fontSize: 18, color: 'var(--ink-3)', margin: '0 0 24px' }}>{stripEmojis(event.event_title)}</h2>

        {/* Event Summary */}
        <div style={{ background: 'rgba(var(--ui-text), 0.05)', border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-2)', marginBottom: 8 }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span>{formatDate(event.event_start, event.event_timezone)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-2)' }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              {formatTime(event.event_start, event.event_timezone)}
              {event.event_end && ` - ${formatTime(event.event_end, event.event_timezone)}`}
            </span>
          </div>
        </div>

        {/* Registration Info */}
        {event.event_link && event.enable_registration ? (
          <>
            <p style={{ color: 'var(--ink-3)', marginBottom: 24, lineHeight: 1.6 }}>
              Click the button below to complete your registration. You&apos;ll be redirected to
              {event.luma_event_id ? ' Luma' : ' our registration partner'} to finish signing up.
            </p>

            <button
              onClick={handleRegister}
              className="cursor-pointer"
              style={{
                width: '100%',
                padding: '16px 32px',
                fontSize: 18,
                fontWeight: 600,
                color: '#fff',
                borderRadius: 12,
                backgroundColor: brandConfig.primaryColor,
                borderColor: brandConfig.primaryColor,
                borderWidth: '3px',
                borderStyle: 'solid',
                boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.5), 0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                transition: 'all 0.2s ease',
              }}
            >
              Continue to registration
            </button>

            <p style={{ fontSize: 14, color: 'var(--ink-4)', marginTop: 16, textAlign: 'center' }}>
              By registering, you agree to the event terms and conditions.
            </p>
          </>
        ) : (
          <div style={{ background: 'rgba(var(--ui-text), 0.06)', border: '1px solid var(--line)', borderRadius: 12, padding: '24px 16px', textAlign: 'center' }}>
            <svg className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--ink-4)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <p style={{ color: 'var(--ink-2)', fontWeight: 500 }}>Registration is currently closed</p>
            <p style={{ color: 'var(--ink-4)', fontSize: 14, marginTop: 4 }}>Check back later or contact the organizer for more information.</p>
          </div>
        )}
      </div>
    </div>
  )
}
