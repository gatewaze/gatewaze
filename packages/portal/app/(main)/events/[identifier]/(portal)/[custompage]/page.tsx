export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { createServerSupabase } from '@/lib/supabase/server'
import { AddedPageContent } from '@/components/event/AddedPageContent'
import { stripEmojis } from '@/lib/text'
import { findEventModulePage } from '@/lib/modules/generated-event-pages'
import { resolveEventTheme } from '@/config/brand'
import { getEnabledModules, isModuleEnabled } from '@/lib/modules/enabledModules'
import { RsvpPageClient } from '@/components/rsvp/RsvpPageClient'

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

  // Check module event pages first
  const modulePage = findEventModulePage(custompage)
  if (modulePage) {
    const event = await getEventForMetadata(identifier, brand)
    const title = event ? stripEmojis(event.event_title) : 'Event'
    return {
      title: `${modulePage.label} - ${title}`,
      description: `${modulePage.label} at ${title}`,
    }
  }

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

  // RSVP page — directly imported to ensure it's bundled in the Docker image
  if (custompage === 'rsvp') {
    const modules = await getEnabledModules()
    if (isModuleEnabled(modules, 'event-invites')) {
      const brand = await getServerBrand()
      const brandConfig = await getBrandConfigById(brand)

      const supabase = await createServerSupabase(brand)
      let eventForTheme = null
      const { data: ev1 } = await supabase
        .from('events')
        .select('gradient_color_1, gradient_color_2, gradient_color_3, portal_theme, theme_colors')
        .eq('event_slug', identifier)
        .maybeSingle()
      eventForTheme = ev1
      if (!eventForTheme) {
        const { data: ev2 } = await supabase
          .from('events')
          .select('gradient_color_1, gradient_color_2, gradient_color_3, portal_theme, theme_colors')
          .eq('event_id', identifier)
          .maybeSingle()
        eventForTheme = ev2
      }

      const resolved = resolveEventTheme(eventForTheme || {}, brandConfig)
      return (
        <Suspense fallback={null}>
          <RsvpPageClient
            eventIdentifier={identifier}
            primaryColor={resolved.primaryColor}
            brandName={brandConfig.name}
          />
        </Suspense>
      )
    }
  }

  // Check other module event pages via generated registry
  const modulePage = findEventModulePage(custompage)
  if (modulePage) {
    const modules = await getEnabledModules()
    if (isModuleEnabled(modules, modulePage.moduleId)) {
      const brand = await getServerBrand()
      const brandConfig = await getBrandConfigById(brand)

      const supabase = await createServerSupabase(brand)
      let eventForTheme = null
      const { data: ev1 } = await supabase
        .from('events')
        .select('gradient_color_1, gradient_color_2, gradient_color_3, portal_theme, theme_colors')
        .eq('event_slug', identifier)
        .maybeSingle()
      eventForTheme = ev1
      if (!eventForTheme) {
        const { data: ev2 } = await supabase
          .from('events')
          .select('gradient_color_1, gradient_color_2, gradient_color_3, portal_theme, theme_colors')
          .eq('event_id', identifier)
          .maybeSingle()
        eventForTheme = ev2
      }

      const resolved = resolveEventTheme(eventForTheme || {}, brandConfig)
      const { default: PageComponent } = await modulePage.component()
      return (
        <Suspense fallback={null}>
          <PageComponent
            eventIdentifier={identifier}
            primaryColor={resolved.primaryColor}
            brandName={brandConfig.name}
          />
        </Suspense>
      )
    }
  }

  // Fall back to custom page content
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
