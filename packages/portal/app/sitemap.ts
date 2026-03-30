import type { MetadataRoute } from 'next'
import { getServerBrandConfig } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const brandConfig = await getServerBrandConfig()
  const baseUrl = `https://${brandConfig.domain}`
  const supabase = await createServerSupabase(brandConfig.id)

  // Check if events module is enabled
  const { data: eventsModule } = await supabase
    .from('installed_modules')
    .select('status')
    .eq('id', 'events')
    .maybeSingle()

  const eventsEnabled = eventsModule?.status === 'enabled'

  // Fetch events only if module is enabled
  let events: any[] = []
  if (eventsEnabled) {
    const { data } = await supabase
      .from('events')
      .select('event_slug, event_id')
      .eq('is_live_in_production', true)
      .eq('is_listed', true)
      .limit(10000)
    events = data || []
  }

  // Fetch all public active calendar slugs
  const { data: calendars } = await supabase
    .from('calendars')
    .select('slug, calendar_id')
    .eq('is_active', true)
    .eq('visibility', 'public')
    .limit(10000)

  // Static pages - only include event pages if events enabled
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: 'daily', priority: 1.0 },
    ...(eventsEnabled ? [
      { url: `${baseUrl}/events/upcoming`, changeFrequency: 'daily' as const, priority: 0.9 },
      { url: `${baseUrl}/events/past`, changeFrequency: 'daily' as const, priority: 0.8 },
      { url: `${baseUrl}/events/calendar`, changeFrequency: 'daily' as const, priority: 0.8 },
      { url: `${baseUrl}/events/map`, changeFrequency: 'daily' as const, priority: 0.8 },
    ] : []),
    { url: `${baseUrl}/privacy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/terms`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/cookie-policy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/do-not-sell`, changeFrequency: 'monthly', priority: 0.3 },
  ]

  // Dynamic event pages (only if events enabled)
  const eventPages: MetadataRoute.Sitemap = events.map((event) => ({
    url: `${baseUrl}/events/${event.event_slug || event.event_id}`,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }))

  // Dynamic calendar pages
  const calendarPages: MetadataRoute.Sitemap = (calendars || []).map((cal) => ({
    url: `${baseUrl}/calendars/${cal.slug || cal.calendar_id}/upcoming`,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }))

  return [...staticPages, ...eventPages, ...calendarPages]
}
