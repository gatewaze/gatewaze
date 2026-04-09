import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ code: string }>
}

/** Server-side check: is the request coming from a custom domain? */
function detectCustomDomain(hdrs: Headers): boolean {
  // Prefer the middleware header if set
  if (hdrs.get('x-custom-domain') === 'true') return true

  // Fall back to checking the host directly
  const host = (hdrs.get('host') || '').split(':')[0]
  if (!host) return false
  if (host.includes('localhost')) return false
  if (host.includes('vercel.app')) return false
  if (host.includes('gatewaze.io')) return false
  if (host.includes('gatewaze.com')) return false

  // Check against configured portal hostname
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  if (appUrl) {
    try {
      const portalHost = new URL(appUrl).hostname
      if (host === portalHost) return false
      // Also check subdomains of the portal domain
      const portalDomain = portalHost.split('.').slice(-2).join('.')
      if (host.endsWith(portalDomain)) return false
    } catch { /* ignore invalid URL */ }
  }

  return true
}

export default async function ShortLinkPage({ params }: Props) {
  const { code } = await params
  const hdrs = await headers()
  const isCustomDomain = detectCustomDomain(hdrs)

  // Look up the party to find which event to redirect to
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
    })

    // Get party and find the first event
    const { data: party } = await supabase
      .from('invite_parties')
      .select('id')
      .eq('short_code', code)
      .single()

    if (party) {
      // Get lead booker's first event
      const { data: leadMember } = await supabase
        .from('invite_party_members')
        .select('id')
        .eq('party_id', party.id)
        .eq('is_lead_booker', true)
        .single()

      if (leadMember) {
        const { data: memberEvent } = await supabase
          .from('invite_party_member_events')
          .select('event_id')
          .eq('party_member_id', leadMember.id)
          .limit(1)
          .single()

        if (memberEvent) {
          const { data: event } = await supabase
            .from('events')
            .select('event_slug, event_id')
            .eq('id', memberEvent.event_id)
            .single()

          if (event) {
            const eventSlug = event.event_slug || event.event_id

            // On custom domains, redirect without the /events/{slug} prefix
            // since the domain already implies the event
            if (isCustomDomain) {
              redirect(`/rsvp?invite=${code}`)
            }

            // Standard portal: include the event path
            redirect(`/events/${eventSlug}/rsvp?invite=${code}`)
          }
        }
      }
    }
  }

  // Fallback: redirect to the standalone module page
  if (isCustomDomain) {
    redirect(`/rsvp?invite=${code}`)
  }
  redirect(`/event-invites/${code}`)
}
