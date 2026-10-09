import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Guest media upload short link — what the printed QR encodes
// (https://<domain>/u/<code>). Resolves the upload link and redirects
// to the event's Photos tab with the code carried in ?u=, mirroring
// the /rsvp/[code] invite redirector. Unknown/inactive codes land on
// the portal home rather than an error page.
//
// Per spec-event-media-guest-uploads §6.1.

interface Props {
  params: Promise<{ code: string }>
}

/** Server-side check: is the request coming from a custom domain?
 *  (Same logic as app/(bare)/rsvp/[code]/page.tsx.) */
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

export default async function GuestUploadShortLinkPage({ params }: Props) {
  const { code } = await params
  const hdrs = await headers()
  const isCustomDomain = detectCustomDomain(hdrs)

  // Only well-formed codes touch the database.
  if (!/^[a-z0-9]{6,16}$/.test(code)) {
    redirect('/')
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  // Service role only — events_media_upload_links deliberately has no
  // anon RLS policy, so an anon-key fallback would just silently
  // redirect every QR scan home. Better to make the misconfiguration
  // loud in logs than dead-end guests quietly.
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl && !supabaseKey) {
    console.error('[u/code] SUPABASE_SERVICE_ROLE_KEY missing — guest upload short links cannot resolve')
  }

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
    })

    interface LinkRow { event_id: string; is_active: boolean; expires_at: string | null }
    const { data: link } = await supabase
      .from('events_media_upload_links')
      .select('event_id, is_active, expires_at')
      .eq('short_code', code)
      .maybeSingle<LinkRow>()

    const active = link
      && link.is_active
      && (!link.expires_at || new Date(link.expires_at).getTime() > Date.now())

    if (active) {
      interface EventRow { event_slug: string | null; event_id: string | null }
      const { data: event } = await supabase
        .from('events')
        .select('event_slug, event_id')
        .eq('id', link.event_id)
        .maybeSingle<EventRow>()

      if (event) {
        const eventSlug = event.event_slug || event.event_id

        // On custom domains the domain already implies the event.
        if (isCustomDomain) {
          redirect(`/photos?u=${code}`)
        }
        redirect(`/events/${eventSlug}/photos?u=${code}`)
      }
    }
  }

  redirect('/')
}
