import type { MetadataRoute } from 'next'
import { getServerBrandConfig } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'

export const revalidate = 3600 // Re-generate at most once per hour

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const brandConfig = await getServerBrandConfig()
  const baseUrl = `https://${brandConfig.domain}`
  const supabase = await createServerSupabase(brandConfig.id)

  // Fetch all live event slugs
  const { data: events } = await supabase
    .from('events')
    .select('event_slug, event_id')
    .eq('is_live_in_production', true)
    .limit(10000)

  // Fetch all public active calendar slugs
  const { data: calendars } = await supabase
    .from('calendars')
    .select('slug, calendar_id')
    .eq('is_active', true)
    .eq('visibility', 'public')
    .limit(10000)

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: 'daily', priority: 1.0 },
    { url: `${baseUrl}/events/upcoming`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${baseUrl}/events/past`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${baseUrl}/events/calendar`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${baseUrl}/events/map`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${baseUrl}/privacy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/terms`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/cookie-policy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/do-not-sell`, changeFrequency: 'monthly', priority: 0.3 },
  ]

  // Dynamic event pages
  const eventPages: MetadataRoute.Sitemap = (events || []).map((event) => ({
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
