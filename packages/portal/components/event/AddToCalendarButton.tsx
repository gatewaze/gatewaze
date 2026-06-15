'use client'

import type { Event } from '@/types/event'
import { escapeICSText, foldLine, formatICSDate } from '@/lib/ics-helpers'

/**
 * "Add to calendar" — downloads a universal .ics for the event (opens in Apple/Google/Outlook etc.).
 * Self-contained so it can sit in the hero alongside Register. Styled to match the mockup's secondary
 * button; colours follow the event's light/dark theme.
 */
export function AddToCalendarButton({
  event,
  useDarkText,
  className = '',
}: {
  event: Event
  useDarkText: boolean
  className?: string
}) {
  const location =
    [event.venue_address, event.event_city]
      .filter((s): s is string => !!s && s.toLowerCase() !== 'na')
      .join(', ') || (event.event_location ?? '')

  const handleClick = () => {
    try {
      const start = event.event_start
      const end = event.event_end || event.event_start
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Gatewaze//Events//EN',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${event.event_id}@gatewaze`,
        `DTSTAMP:${formatICSDate(new Date().toISOString())}`,
        `DTSTART:${formatICSDate(start)}`,
        `DTEND:${formatICSDate(end)}`,
        foldLine(`SUMMARY:${escapeICSText(event.event_title)}`),
        ...(location ? [foldLine(`LOCATION:${escapeICSText(location)}`)] : []),
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${event.event_slug || event.event_id}.ics`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg font-medium text-sm transition-colors ${className}`}
      style={{
        backgroundColor: useDarkText ? 'rgba(17,24,39,0.06)' : 'rgba(255,255,255,0.10)',
        color: useDarkText ? '#111827' : '#ffffff',
        border: `1px solid ${useDarkText ? 'rgba(17,24,39,0.12)' : 'rgba(255,255,255,0.18)'}`,
        backdropFilter: 'blur(var(--glass-blur, 4px))',
        WebkitBackdropFilter: 'blur(var(--glass-blur, 4px))',
      }}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4.5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v3M16 3v3" />
      </svg>
      Add to calendar
    </button>
  )
}

export default AddToCalendarButton
