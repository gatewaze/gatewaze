import { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { extractEventIdFromSlug } from '@/lib/slugify'
import { resolveEventImages } from '@/lib/storage-resolve'
import { LandingHero } from './LandingHero'

export const dynamic = 'force-dynamic'

function getLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '')
  if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) return 0
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255
  const R = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  const G = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  const B = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

function shouldUseDarkText(color1: string, color2: string): boolean {
  const avgLuminance = getLuminance(color1) * 0.6 + getLuminance(color2) * 0.4
  return avgLuminance > 0.5
}

interface Props {
  params: Promise<{ identifier: string }>
}

interface LandingEvent {
  event_id: string
  event_slug: string | null
  event_title: string
  event_start: string
  event_end: string
  event_timezone: string | null
  event_city: string | null
  event_region: string | null
  event_country_code: string | null
  event_location: string | null
  venue_address: string | null
  event_logo: string | null
  screenshot_url: string | null
  event_link: string | null
  listing_intro: string | null
  gradient_color_1: string | null
  gradient_color_2: string | null
  gradient_color_3: string | null
  register_button_text: string | null
}

const EVENT_FIELDS = `
  event_id,
  event_slug,
  event_title,
  event_start,
  event_end,
  event_timezone,
  event_city,
  event_region,
  event_country_code,
  event_location,
  venue_address,
  event_logo,
  screenshot_url,
  event_link,
  listing_intro,
  gradient_color_1,
  gradient_color_2,
  gradient_color_3,
  register_button_text
`

async function getEvent(identifier: string, brandId: string): Promise<LandingEvent | null> {
  const supabase = await createServerSupabase(brandId)
  const brandConfig = await getBrandConfigById(brandId)

  let { data: event } = await supabase
    .from('events')
    .select(EVENT_FIELDS)
    .eq('event_slug', identifier)
    .eq('is_live_in_production', true)
    .maybeSingle()

  if (!event) {
    const result = await supabase
      .from('events')
      .select(EVENT_FIELDS)
      .eq('event_id', identifier)
      .eq('is_live_in_production', true)
      .maybeSingle()
    event = result.data
  }

  if (!event && identifier.includes('-')) {
    const extractedId = extractEventIdFromSlug(identifier)
    if (extractedId !== identifier) {
      const result = await supabase
        .from('events')
        .select(EVENT_FIELDS)
        .eq('event_id', extractedId)
        .eq('is_live_in_production', true)
        .maybeSingle()
      event = result.data
    }
  }

  return resolveEventImages(event as LandingEvent | null, brandConfig.storageBucketUrl) ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEvent(identifier, brand)

  if (!event) {
    return { title: `Event not found - ${brandConfig.name}` }
  }

  return {
    title: `${event.event_title} - ${brandConfig.name}`,
    description: event.listing_intro || `Join us for ${event.event_title}`,
    openGraph: {
      title: event.event_title,
      description: event.listing_intro || `Join us for ${event.event_title}`,
      images: event.screenshot_url ? [{ url: event.screenshot_url }] : event.event_logo ? [{ url: event.event_logo }] : [],
      type: 'website',
    },
  }
}

export default async function RedditLandingPage({ params }: Props) {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEvent(identifier, brand)

  if (!event || !event.event_link) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Event not found</h1>
          <p className="text-gray-600 mb-4">
            {!event ? 'This event could not be found or is no longer available.' : 'This event does not have a registration link.'}
          </p>
          <a
            href={`https://${brandConfig.domain}`}
            className="cursor-pointer inline-block px-6 py-3 text-white font-semibold rounded-lg shadow-md hover:shadow-xl hover:brightness-110 transition-all duration-200"
            style={{ backgroundColor: brandConfig.primaryColor }}
          >
            Go to {brandConfig.name}
          </a>
        </div>
      </div>
    )
  }

  const primaryColor = brandConfig.primaryColor
  const secondaryColor = brandConfig.secondaryColor
  const useDarkText = shouldUseDarkText(primaryColor, secondaryColor)

  return (
    <div className="min-h-screen flex items-center" style={{ backgroundColor: secondaryColor }}>
      {/* CSS gradient background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 100% 100% at 100% 100%, ${primaryColor} 0%, transparent 80%),
                       radial-gradient(ellipse 80% 80% at 0% 0%, ${secondaryColor} 0%, transparent 70%),
                       linear-gradient(135deg, ${secondaryColor} 0%, ${primaryColor}60 100%),
                       ${secondaryColor}`,
        }}
      />

      {/* Content — vertically centered */}
      <main className="relative z-10 w-full">
        <div className="max-w-7xl mx-auto px-6 sm:px-6 lg:px-8 py-12">
          <LandingHero
            event={event}
            identifier={identifier}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            useDarkText={useDarkText}
          />
        </div>
      </main>
    </div>
  )
}
