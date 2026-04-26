import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Public ICS feed for a calendar.
 *
 *   GET /api/calendars/{slug}/feed.ics
 *
 * Returns a VCALENDAR document containing every public event linked to the
 * calendar. Subscribers (Google / Outlook / Apple) re-fetch this URL on a
 * schedule, so new events flow into their personal calendar automatically.
 *
 * The route is intentionally CDN-cacheable for a few minutes — calendar
 * clients refresh on their own cadence (typically every hour or two), so
 * the small staleness window is fine and protects the database from a
 * thundering-herd.
 */

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}` }

function formatICSDate(iso: string): string {
  const d = new Date(iso)
  // YYYYMMDDTHHMMSSZ
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

/**
 * Escape a value per RFC 5545 §3.3.11. Newlines become `\n`, commas/semicolons
 * are backslash-escaped, and we strip CR characters that would break folding.
 */
function escapeICSText(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * Fold a content line per RFC 5545 §3.1: lines longer than 75 octets must
 * be split, with each continuation prefixed by a single space.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  for (let i = 0; i < line.length; i += 73) {
    parts.push(i === 0 ? line.slice(i, i + 75) : ' ' + line.slice(i, i + 73))
  }
  return parts.join('\r\n')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = getSupabase()

  // Resolve the calendar by slug or calendar_id (CAL-XXXXXXXX).
  const { data: calendar } = await supabase
    .from('calendars')
    .select('id, calendar_id, name, slug, description, external_url')
    .or(`slug.eq.${slug},calendar_id.eq.${slug}`)
    .eq('is_active', true)
    .eq('visibility', 'public')
    .maybeSingle()

  if (!calendar) {
    return new NextResponse('Calendar not found', { status: 404 })
  }

  // Pull events linked to this calendar via the junction table. We include
  // a generous past window so subscribers see recent context, plus all
  // future events.
  const sixMonthsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6).toISOString()

  const { data: rows } = await supabase
    .from('calendars_events')
    .select(`
      events!inner(
        id,
        event_id,
        event_slug,
        event_title,
        event_start,
        event_end,
        event_timezone,
        event_description,
        event_location,
        venue_address,
        event_link,
        event_city,
        event_country_code
      )
    `)
    .eq('calendar_id', (calendar as any).id)
    .eq('events.is_live_in_production', true)
    .gte('events.event_start', sixMonthsAgo)
    .order('event_start', { foreignTable: 'events', ascending: true })
    .limit(2000)

  const events: any[] = (rows || []).map((r: any) => r.events).filter(Boolean)

  const portalBase = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  const cal = calendar as any
  const calName = `${cal.name}`
  const calDesc = cal.description || `Events from ${cal.name}`

  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//Gatewaze//Calendars//EN')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')
  lines.push(foldLine(`X-WR-CALNAME:${escapeICSText(calName)}`))
  lines.push(foldLine(`X-WR-CALDESC:${escapeICSText(calDesc)}`))
  // Refresh hint for clients that honour it (most do).
  lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT2H')
  lines.push('X-PUBLISHED-TTL:PT2H')

  const stamp = formatICSDate(new Date().toISOString())

  for (const ev of events) {
    if (!ev.event_start) continue
    const start = ev.event_start as string
    // Default to a 1-hour window if no end time is recorded.
    const end = ev.event_end || new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString()
    const eventUrl = portalBase
      ? `${portalBase}/events/${ev.event_slug || ev.event_id}`
      : (ev.event_link || '')
    const location = ev.event_location
      || ev.venue_address
      || [ev.event_city, ev.event_country_code].filter(Boolean).join(', ')
      || ''

    lines.push('BEGIN:VEVENT')
    lines.push(foldLine(`UID:${ev.event_id || ev.id}@gatewaze.calendars.${cal.calendar_id}`))
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART:${formatICSDate(start)}`)
    lines.push(`DTEND:${formatICSDate(end)}`)
    lines.push(foldLine(`SUMMARY:${escapeICSText(ev.event_title)}`))
    if (ev.event_description) {
      lines.push(foldLine(`DESCRIPTION:${escapeICSText(ev.event_description)}`))
    }
    if (location) {
      lines.push(foldLine(`LOCATION:${escapeICSText(location)}`))
    }
    if (eventUrl) {
      lines.push(foldLine(`URL:${eventUrl}`))
    }
    lines.push('STATUS:CONFIRMED')
    lines.push('TRANSP:OPAQUE')
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  const body = lines.join('\r\n') + '\r\n'

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${(cal.slug || cal.calendar_id)}.ics"`,
      // Allow CDNs / clients to cache for 5 minutes; calendar clients
      // typically poll every hour or two anyway.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  })
}
