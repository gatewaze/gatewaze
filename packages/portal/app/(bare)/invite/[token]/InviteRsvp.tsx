'use client'

import { useState, useEffect } from 'react'
import { getClientBrandConfig, isLightColor } from '@/config/brand'

interface InviteData {
  id: string
  event_id: string
  email: string
  first_name: string | null
  last_name: string | null
  token: string
  status: string
  rsvp_response: string | null
  rsvp_message: string | null
  expires_at: string | null
  event_title: string | null
  event_start: string | null
  event_end: string | null
  event_location: string | null
}

interface EventData {
  event_id: string
  event_title: string
  event_start: string
  event_end: string
  event_location: string | null
  event_logo: string | null
  screenshot_url: string | null
  event_link: string | null
  listing_intro: string | null
  gradient_color_1: string | null
  gradient_color_2: string | null
  gradient_color_3: string | null
}

interface Props {
  invite: InviteData
  event: EventData | null
  token: string
  primaryColor: string
  brandName: string
}

export function InviteRsvp({ invite, event, token, primaryColor, brandName }: Props) {
  const [rsvpResponse, setRsvpResponse] = useState<string | null>(invite.rsvp_response)
  const [message, setMessage] = useState(invite.rsvp_message || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(!!invite.rsvp_response)
  const [error, setError] = useState<string | null>(null)

  // Track the page open
  useEffect(() => {
    trackInteraction('opened')
  }, [])

  const trackInteraction = async (type: string) => {
    try {
      const config = getClientBrandConfig()
      await fetch(`${config.supabaseUrl}/functions/v1/event-invite-rsvp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          action: 'track',
          token,
          interaction_type: type,
        }),
      })
    } catch {
      // Tracking failures are non-critical
    }
  }

  const handleSubmit = async (response: 'yes' | 'no' | 'maybe') => {
    setIsSubmitting(true)
    setError(null)

    try {
      const config = getClientBrandConfig()
      const res = await fetch(`${config.supabaseUrl}/functions/v1/event-invite-rsvp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          action: 'rsvp',
          token,
          rsvp_response: response,
          rsvp_message: message.trim() || null,
        }),
      })

      const result = await res.json()

      if (!result.success) {
        setError(result.error || 'Failed to submit RSVP')
        return
      }

      setRsvpResponse(response)
      setIsSubmitted(true)
    } catch {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const buttonTextColor = isLightColor(primaryColor) ? '#000000' : '#ffffff'
  const firstName = invite.first_name || invite.email.split('@')[0]

  // Already responded
  if (isSubmitted) {
    const responseLabels: Record<string, string> = {
      yes: "You're going!",
      no: "You've declined",
      maybe: "You're a maybe",
    }

    return (
      <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/20 text-center">
        {event?.event_logo && (
          <img src={event.event_logo} alt="" className="w-16 h-16 rounded-lg mx-auto mb-4 object-cover" />
        )}

        <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: primaryColor }}>
          {rsvpResponse === 'yes' ? (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={buttonTextColor}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : rsvpResponse === 'no' ? (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={buttonTextColor}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={buttonTextColor}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">{responseLabels[rsvpResponse || 'yes']}</h1>
        <p className="text-white/80 mb-6">
          {rsvpResponse === 'yes'
            ? `See you at ${invite.event_title}!`
            : rsvpResponse === 'maybe'
            ? `We hope to see you at ${invite.event_title}.`
            : `Thanks for letting us know about ${invite.event_title}.`}
        </p>

        {/* Event details */}
        <div className="bg-black/20 rounded-lg p-4 text-left space-y-2 mb-6">
          <h3 className="text-white font-semibold">{invite.event_title}</h3>
          {invite.event_start && (
            <p className="text-white/70 text-sm">
              {formatDate(invite.event_start)} at {formatTime(invite.event_start)}
            </p>
          )}
          {invite.event_location && (
            <p className="text-white/70 text-sm">{invite.event_location}</p>
          )}
        </div>

        {/* Change response */}
        <button
          onClick={() => {
            setIsSubmitted(false)
            setRsvpResponse(null)
          }}
          className="text-sm text-white/50 hover:text-white/80 underline cursor-pointer transition-colors"
        >
          Change your response
        </button>
      </div>
    )
  }

  // RSVP form
  return (
    <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/20">
      {event?.event_logo && (
        <img src={event.event_logo} alt="" className="w-16 h-16 rounded-lg mx-auto mb-4 object-cover" />
      )}

      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">You&apos;re Invited!</h1>
        <p className="text-white/80">
          Hi {firstName}, you&apos;ve been invited to:
        </p>
      </div>

      {/* Event card */}
      <div className="bg-black/20 rounded-lg p-4 space-y-2 mb-6">
        <h2 className="text-xl font-bold text-white">{invite.event_title}</h2>
        {invite.event_start && (
          <p className="text-white/70 text-sm flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {formatDate(invite.event_start)} at {formatTime(invite.event_start)}
          </p>
        )}
        {invite.event_location && (
          <p className="text-white/70 text-sm flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {invite.event_location}
          </p>
        )}
        {event?.listing_intro && (
          <p className="text-white/60 text-sm mt-2">{event.listing_intro}</p>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Optional message */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-white/80 mb-2">
          Message (optional)
        </label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Add a note to your RSVP..."
          rows={2}
          className="w-full px-4 py-2.5 text-sm border border-white/20 rounded-lg bg-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 resize-none"
        />
      </div>

      {/* RSVP buttons */}
      <div className="space-y-3">
        <button
          onClick={() => handleSubmit('yes')}
          disabled={isSubmitting}
          className="w-full py-3 px-6 rounded-lg font-semibold text-base transition-all duration-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          style={{ backgroundColor: primaryColor, color: buttonTextColor }}
        >
          {isSubmitting ? 'Submitting...' : "Yes, I'll be there!"}
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleSubmit('maybe')}
            disabled={isSubmitting}
            className="py-2.5 px-4 rounded-lg font-medium text-sm bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Maybe
          </button>
          <button
            onClick={() => handleSubmit('no')}
            disabled={isSubmitting}
            className="py-2.5 px-4 rounded-lg font-medium text-sm bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Can&apos;t make it
          </button>
        </div>
      </div>

      <p className="text-center text-white/40 text-xs mt-6">
        Powered by {brandName}
      </p>
    </div>
  )
}
