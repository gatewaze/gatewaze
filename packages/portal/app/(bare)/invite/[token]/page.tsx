import { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { InviteRsvp } from './InviteRsvp'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ token: string }>
}

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

async function getInvite(token: string, brandId: string): Promise<InviteData | null> {
  const supabase = await createServerSupabase(brandId)

  const { data } = await supabase
    .from('module_event_invites_with_details')
    .select('id, event_id, email, first_name, last_name, token, status, rsvp_response, rsvp_message, expires_at, event_title, event_start, event_end, event_location')
    .eq('token', token)
    .maybeSingle()

  return data
}

async function getEventDetails(eventId: string, brandId: string) {
  const supabase = await createServerSupabase(brandId)

  const { data } = await supabase
    .from('events')
    .select('event_id, event_title, event_start, event_end, event_location, event_logo, screenshot_url, event_link, listing_intro, gradient_color_1, gradient_color_2, gradient_color_3')
    .eq('event_id', eventId)
    .maybeSingle()

  return data
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const invite = await getInvite(token, brand)

  if (!invite) {
    return { title: `Invitation not found - ${brandConfig.name}` }
  }

  return {
    title: `RSVP: ${invite.event_title || 'Event'} - ${brandConfig.name}`,
    description: `You've been invited to ${invite.event_title || 'an event'}. RSVP now!`,
    openGraph: {
      title: `You're Invited: ${invite.event_title || 'Event'}`,
      description: `RSVP for ${invite.event_title || 'this event'}`,
      type: 'website',
    },
  }
}

function isLightColor(hex: string): boolean {
  const clean = hex.replace('#', '')
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return false
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.5
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const invite = await getInvite(token, brand)

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Invitation not found</h1>
          <p className="text-gray-600 mb-4">
            This invitation link is invalid or has expired.
          </p>
          <a
            href={`https://${brandConfig.domain}`}
            className="inline-block px-6 py-3 text-white font-semibold rounded-lg shadow-md hover:shadow-xl transition-all duration-200"
            style={{ backgroundColor: brandConfig.primaryColor }}
          >
            Go to {brandConfig.name}
          </a>
        </div>
      </div>
    )
  }

  // Check expiry
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Invitation expired</h1>
          <p className="text-gray-600 mb-4">
            This invitation for <strong>{invite.event_title}</strong> has expired.
          </p>
        </div>
      </div>
    )
  }

  const event = await getEventDetails(invite.event_id, brand)
  const primaryColor = event?.gradient_color_1 || brandConfig.primaryColor
  const secondaryColor = event?.gradient_color_2 || brandConfig.secondaryColor

  return (
    <div className="min-h-screen flex items-center" style={{ backgroundColor: secondaryColor }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 100% 100% at 100% 100%, ${primaryColor} 0%, transparent 80%),
                       radial-gradient(ellipse 80% 80% at 0% 0%, ${secondaryColor} 0%, transparent 70%),
                       linear-gradient(135deg, ${secondaryColor} 0%, ${primaryColor}60 100%),
                       ${secondaryColor}`,
        }}
      />

      <main className="relative z-10 w-full">
        <div className="max-w-lg mx-auto px-6 py-12">
          <InviteRsvp
            invite={invite}
            event={event}
            token={token}
            primaryColor={primaryColor}
            brandName={brandConfig.name}
          />
        </div>
      </main>
    </div>
  )
}
