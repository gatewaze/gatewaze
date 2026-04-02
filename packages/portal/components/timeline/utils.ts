import type { Event } from '@/types/event'

export interface EventGroup {
  dateKey: string
  displayDate: string
  displayDay: string
  events: Event[]
}

/**
 * Group events by date (using event_start)
 * @param events - The events to group
 * @param descending - If true, sort groups with most recent first (for past events)
 */
export function groupEventsByDate(events: Event[], descending = false): EventGroup[] {
  const groups = new Map<string, Event[]>()

  for (const event of events) {
    const date = new Date(event.event_start)
    const dateKey = date.toISOString().split('T')[0]

    if (!groups.has(dateKey)) {
      groups.set(dateKey, [])
    }
    groups.get(dateKey)!.push(event)
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => (descending ? b.localeCompare(a) : a.localeCompare(b)))
    .map(([dateKey, groupEvents]) => {
      const date = new Date(dateKey + 'T12:00:00')
      return {
        dateKey,
        displayDate: formatDisplayDate(date),
        displayDay: formatDisplayDay(date),
        events: groupEvents.sort(
          (a, b) => new Date(a.event_start).getTime() - new Date(b.event_start).getTime()
        ),
      }
    })
}

/**
 * Split events into upcoming and past based on current time
 */
export function splitEventsByTime(events: Event[]): {
  upcoming: Event[]
  past: Event[]
} {
  const now = new Date()

  return {
    upcoming: events.filter((e) => new Date(e.event_end || e.event_start) >= now),
    past: events
      .filter((e) => new Date(e.event_end || e.event_start) < now)
      .sort((a, b) => new Date(b.event_start).getTime() - new Date(a.event_start).getTime()),
  }
}

/**
 * Format date for display: "3 Mar"
 */
function formatDisplayDate(date: Date): string {
  const day = date.getDate()
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  return `${day} ${month}`
}

/**
 * Format day of week: "Tuesday", or "Today" if the date is today
 */
function formatDisplayDay(date: Date): string {
  const now = new Date()
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return 'Today'
  }
  return date.toLocaleDateString('en-US', { weekday: 'long' })
}

/**
 * Format date for event card: "3 Mar"
 */
export function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr)
  const day = date.getDate()
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  return `${day} ${month}`
}

/**
 * Format time for event card: "9:30 AM"
 * Returns null if the time is midnight (00:00), indicating no specific time was set.
 */
export function formatEventTime(dateStr: string): string | null {
  const date = new Date(dateStr)
  // Use UTC to check for midnight so the result is consistent between server and client timezones
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0) return null
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}
