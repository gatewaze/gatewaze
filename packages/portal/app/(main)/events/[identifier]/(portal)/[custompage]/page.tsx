import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { AddedPageContent } from '@/components/event/AddedPageContent'
import { stripEmojis } from '@/lib/text'

interface Props {
  params: Promise<{ identifier: string; custompage: string }>
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function getEventForMetadata(identifier: string, brandId: string) {
  const supabase = await createServerSupabase(brandId)

  let { data: event } = await supabase
    .from('events')
    .select('event_title, screenshot_url, event_logo, addedpage_title, addedpage_content')
    .eq('event_slug', identifier)
    .eq('is_live_in_production', true)
    .maybeSingle()

  if (!event) {
    const result = await supabase
      .from('events')
      .select('event_title, screenshot_url, event_logo, addedpage_title, addedpage_content')
      .eq('event_id', identifier)
      .eq('is_live_in_production', true)
      .maybeSingle()
    event = result.data
  }

  return event
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { identifier, custompage } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const event = await getEventForMetadata(identifier, brand)

  if (!event || !event.addedpage_content) {
    return { title: 'Page Not Found' }
  }

  // Verify the slug matches
  const expectedSlug = slugify(event.addedpage_title || 'Workshops')
  if (custompage !== expectedSlug) {
    return { title: 'Page Not Found' }
  }

  const title = stripEmojis(event.event_title)
  const pageTitle = event.addedpage_title || 'Workshops'

  return {
    title: `${pageTitle} - ${title}`,
    description: `${pageTitle} at ${title}`,
    openGraph: {
      title: `${pageTitle} - ${title}`,
      description: `${pageTitle} at ${title}`,
      images: event.screenshot_url ? [{ url: event.screenshot_url }] : event.event_logo ? [{ url: event.event_logo }] : [],
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${pageTitle} - ${title}`,
      description: `${pageTitle} at ${title}`,
      images: event.screenshot_url ? [event.screenshot_url] : event.event_logo ? [event.event_logo] : [],
    },
  }
}

export default async function CustomPage({ params }: Props) {
  const { identifier, custompage } = await params
  const brand = await getServerBrand()
  const event = await getEventForMetadata(identifier, brand)

  if (!event || !event.addedpage_content) {
    notFound()
  }

  // Verify the slug matches the expected page
  const expectedSlug = slugify(event.addedpage_title || 'Workshops')
  if (custompage !== expectedSlug) {
    notFound()
  }

  return <AddedPageContent />
}
