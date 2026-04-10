import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ code: string }>
}

/**
 * Short-link entry point for self-serve Open RSVP links.
 *
 * Resolves `/o/{code}` → the event the open link is scoped to, then
 * redirects to that event's open-rsvp page so the form renders inside the
 * full event portal layout (same UX as the standard `/rsvp/{code}` flow).
 *
 * On custom domains (one domain = one event), the event-slug prefix is
 * omitted since the host already implies the event.
 */
function detectCustomDomain(hdrs: Headers): boolean {
  if (hdrs.get('x-custom-domain') === 'true') return true
  const host = (hdrs.get('host') || '').split(':')[0]
  if (!host) return false
  if (host.includes('localhost')) return false
  if (host.includes('vercel.app')) return false
  if (host.includes('gatewaze.io')) return false
  if (host.includes('gatewaze.com')) return false
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  if (appUrl) {
    try {
      const portalHost = new URL(appUrl).hostname
      if (host === portalHost) return false
      const portalDomain = portalHost.split('.').slice(-2).join('.')
      if (host.endsWith(portalDomain)) return false
    } catch { /* ignore invalid URL */ }
  }
  return true
}

export default async function OpenRsvpShortLink({ params }: Props) {
  const { code } = await params
  const hdrs = await headers()
  const isCustomDomain = detectCustomDomain(hdrs)

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
    })

    // Look up the open link to find its event
    const { data: link } = await supabase
      .from('invite_open_links')
      .select('event_id, is_active, expires_at')
      .eq('short_code', code)
      .maybeSingle()

    if (link && link.is_active && (!link.expires_at || new Date(link.expires_at) > new Date())) {
      const { data: event } = await supabase
        .from('events')
        .select('event_slug, event_id')
        .eq('id', link.event_id)
        .single()

      if (event) {
        const eventSlug = event.event_slug || event.event_id

        if (isCustomDomain) {
          redirect(`/open-rsvp?o=${code}`)
        }
        redirect(`/events/${eventSlug}/open-rsvp?o=${code}`)
      }
    }
  }

  // Fallback — link not found or lookup failed. Send the user somewhere
  // harmless rather than 500ing.
  redirect('/')
}
