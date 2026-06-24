import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getEnabledModules, isModuleEnabled } from '@/lib/modules/enabledModules'
import { findModulePage, extractParams } from '@/lib/modules/generated-portal-modules'
import { createServerSupabase } from '@/lib/supabase/server'
import { getServerBrandConfig } from '@/config/brand'
import { editionFolderSlug } from '@gatewaze-modules/newsletters/lib/edition-slug'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ path: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// Build page-specific metadata for module portal pages. The catch-all is the
// only Next.js route that owns these URLs, so any per-page <title>/og: that
// link-unfurl previews need (Slack, iMessage, Twitter) has to be assembled
// here — module pages themselves are 'use client' and can't export
// generateMetadata directly.
//
// Today we special-case the newsletter edition page; other module pages
// fall through to the layout default. As more modules need rich previews
// they can be added to the dispatch table below.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params
  const pathname = '/' + path.join('/')

  // /newsletters/{collectionSlug}/{YYYY-MM-DD-edition-slug}
  const newsletterMatch = pathname.match(/^\/newsletters\/([^/]+)\/(\d{4}-\d{2}-\d{2})-(.+)$/)
  if (newsletterMatch) {
    const [, collectionSlug, dateStr] = newsletterMatch
    const fullEditionParam = `${dateStr}-${newsletterMatch[3]}`
    return newsletterEditionMetadata(collectionSlug, dateStr, fullEditionParam)
  }

  return {}
}

async function newsletterEditionMetadata(
  collectionSlug: string,
  date: string,
  editionParam: string,
): Promise<Metadata> {
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)

    const { data: collection } = await supabase
      .from('newsletters_template_collections')
      .select('id, name')
      .eq('slug', collectionSlug)
      .single()
    if (!collection) return {}

    const { data: candidates } = await supabase
      .from('newsletters_editions')
      .select('id, title, edition_date, preheader')
      .eq('collection_id', collection.id)
      .eq('edition_date', date)
      .eq('status', 'published')
      .order('created_at', { ascending: false })

    const edition =
      (candidates ?? []).find(
        (c) => editionFolderSlug(c.edition_date, c.title) === editionParam,
      ) ?? (candidates ?? [])[0]
    if (!edition) return {}

    const title = `${edition.title} — ${collection.name}`
    const description =
      (edition.preheader && edition.preheader.trim()) ||
      `${edition.title} from ${collection.name}, ${brand.name}.`
    const url = `/newsletters/${collectionSlug}/${editionParam}`
    const ogImage = brand.logoUrl ?? brand.faviconUrl ?? undefined

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'article',
        url,
        siteName: brand.name,
        images: ogImage ? [{ url: ogImage }] : undefined,
        publishedTime: edition.edition_date,
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: ogImage ? [ogImage] : undefined,
      },
    }
  } catch (err) {
    // Metadata failures should never break the page render — return empty
    // and let the layout default carry through. Log so we can spot
    // misconfigurations that quietly degrade unfurls.
    console.warn('[newsletter-metadata] failed to build:', err)
    return {}
  }
}

export default async function ModulePage({ params, searchParams }: Props) {
  const { path } = await params
  const resolvedSearchParams = await searchParams
  const pathname = '/' + path.join('/')

  const page = findModulePage(pathname)
  if (!page) {
    notFound()
  }

  // Check that the module is enabled
  const modules = await getEnabledModules()
  if (!isModuleEnabled(modules, page.moduleId)) {
    redirect('/')
  }

  // Extract dynamic params from route pattern (e.g., /forms/[slug] → { slug: 'meetup-organizer' })
  const moduleParams = extractParams(page.path, pathname)

  // Lazy-load and render the module's page component
  const { default: PageComponent } = await page.component()

  // Pass API URL from server env so client components can reach the API service
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''

  // Forward both params and searchParams so module pages can read query
  // string values (e.g. /calendars/[slug]/confirm?token=...)
  return (
    <Suspense fallback={null}>
      <PageComponent
        params={moduleParams}
        searchParams={resolvedSearchParams}
        apiUrl={apiUrl}
      />
    </Suspense>
  )
}
