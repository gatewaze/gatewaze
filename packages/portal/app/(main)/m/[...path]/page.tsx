import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getEnabledModules, isModuleEnabled } from '@/lib/modules/enabledModules'
import { findModulePage, extractParams } from '@/lib/modules/generated-portal-modules'
import { createServerSupabase } from '@/lib/supabase/server'
import { getServerBrandConfig } from '@/config/brand'
import { editionFolderSlug } from '@gatewaze-modules/newsletters/lib/edition-slug'
import { loadPublishedEdition, editionBodyMarkdown } from '@/lib/agent-content/newsletter'

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

  // /newsletters/{collectionSlug} (archive)
  const newsletterCollectionMatch = pathname.match(/^\/newsletters\/([^/]+)$/)
  if (newsletterCollectionMatch) {
    return newsletterCollectionMetadata(newsletterCollectionMatch[1])
  }

  // /resources/{collectionSlug}/{itemSlug}
  const resourceItemMatch = pathname.match(/^\/resources\/([^/]+)\/([^/]+)$/)
  if (resourceItemMatch) {
    return resourceItemMetadata(resourceItemMatch[1], resourceItemMatch[2])
  }

  // /resources/{collectionSlug}
  const resourceCollectionMatch = pathname.match(/^\/resources\/([^/]+)$/)
  if (resourceCollectionMatch) {
    return resourceCollectionMetadata(resourceCollectionMatch[1])
  }

  // /blog/{slug}
  const blogPostMatch = pathname.match(/^\/blog\/([^/]+)$/)
  if (blogPostMatch) {
    return blogPostMetadata(blogPostMatch[1])
  }

  // Generic fallback: title module pages by their nav label so /newsletters,
  // /resources, /calendars, /blog etc. read as themselves instead of
  // inheriting the layout's bare-brand default. Sub-pages that need richer
  // metadata get their own matcher above.
  try {
    const modules = await getEnabledModules()
    const seg = '/' + (path[0] || '')
    const railItem = modules.railItems.find((it) => it.moduleId !== 'home' && it.href.split('?')[0].startsWith(seg))
    if (railItem) {
      return { title: railItem.full || railItem.label }
    }
  } catch {
    /* fall through to the layout default */
  }

  return {}
}

/**
 * Blog post metadata — prefers the post's own SEO columns (meta_*, og_*,
 * canonical_url) when set, else derives from title/excerpt. Canonical falls back
 * to the brand-domain self URL; a text/markdown alternate points at /md.
 */
interface BlogPostMetaRow {
  title: string
  slug: string
  excerpt: string | null
  featured_image: string | null
  published_at: string | null
  updated_at: string | null
  meta_title: string | null
  meta_description: string | null
  canonical_url: string | null
  og_title: string | null
  og_description: string | null
  og_image: string | null
  twitter_title: string | null
  twitter_description: string | null
  twitter_image: string | null
}

async function blogPostMetadata(slug: string): Promise<Metadata> {
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)
    const baseUrl = `https://${brand.domain}`

    const { data: post } = await supabase
      .from('blog_posts')
      .select(
        'title, slug, excerpt, featured_image, published_at, updated_at, meta_title, meta_description, ' +
          'canonical_url, og_title, og_description, og_image, twitter_title, twitter_description, twitter_image',
      )
      .eq('slug', slug)
      .eq('status', 'published')
      .eq('visibility', 'public')
      .maybeSingle()
      .then((r) => ({ ...r, data: r.data as BlogPostMetaRow | null }))
    if (!post) return {}

    const path = `/blog/${post.slug}`
    const title = post.meta_title || post.title
    const description = post.meta_description || post.excerpt || `${post.title} — ${brand.name}.`
    const ogImage = post.og_image || post.featured_image || brand.logoUrl || undefined

    return {
      title,
      description,
      alternates: {
        canonical: post.canonical_url || `${baseUrl}${path}`,
        types: { 'text/markdown': `${baseUrl}/md${path}` },
      },
      openGraph: {
        title: post.og_title || title,
        description: post.og_description || description,
        type: 'article',
        url: `${baseUrl}${path}`,
        siteName: brand.name,
        images: ogImage ? [{ url: ogImage }] : undefined,
        publishedTime: post.published_at ?? undefined,
        modifiedTime: post.updated_at ?? undefined,
      },
      twitter: {
        card: 'summary_large_image',
        title: post.twitter_title || title,
        description: post.twitter_description || description,
        images: (() => {
          const img = post.twitter_image || ogImage
          return img ? [img] : undefined
        })(),
      },
    }
  } catch (err) {
    console.warn('[blog-post-metadata] failed to build:', err)
    return {}
  }
}

/**
 * Resource item metadata. Canonical + og:url use the brand's canonical domain
 * (not the serving host) so the same content on a custom domain collapses to
 * one canonical URL. A `text/markdown` alternate points agents at the clean
 * /md representation — emitted only for anon-visible (public) items, since the
 * anon client returns nothing for gated ones.
 */
async function resourceItemMetadata(collectionSlug: string, itemSlug: string): Promise<Metadata> {
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)
    const baseUrl = `https://${brand.domain}`

    const { data: collection } = await supabase
      .from('sr_collections')
      .select('id, name, meta_description')
      .eq('slug', collectionSlug)
      .eq('status', 'published')
      .maybeSingle()
    if (!collection) return {}

    const { data: item } = await supabase
      .from('sr_items')
      .select('title, subtitle, featured_image_url, created_at, updated_at')
      .eq('collection_id', collection.id)
      .eq('slug', itemSlug)
      .eq('status', 'published')
      .maybeSingle()
    if (!item) return {} // gated or missing → layout default

    const path = `/resources/${collectionSlug}/${itemSlug}`
    const title = `${item.title} — ${collection.name}`
    const description =
      (item.subtitle && item.subtitle.trim()) ||
      collection.meta_description ||
      `${item.title} from ${collection.name}, ${brand.name}.`
    const ogImage = item.featured_image_url || brand.logoUrl || brand.faviconUrl || undefined

    return {
      title,
      description,
      alternates: {
        canonical: `${baseUrl}${path}`,
        types: { 'text/markdown': `${baseUrl}/md${path}` },
      },
      openGraph: {
        title,
        description,
        type: 'article',
        url: `${baseUrl}${path}`,
        siteName: brand.name,
        images: ogImage ? [{ url: ogImage }] : undefined,
        publishedTime: item.created_at ?? undefined,
        modifiedTime: item.updated_at ?? undefined,
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: ogImage ? [ogImage] : undefined,
      },
    }
  } catch (err) {
    console.warn('[resource-item-metadata] failed to build:', err)
    return {}
  }
}

/** Resource collection (archive) metadata. */
async function resourceCollectionMetadata(collectionSlug: string): Promise<Metadata> {
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)
    const baseUrl = `https://${brand.domain}`

    const { data: collection } = await supabase
      .from('sr_collections')
      .select('name, description, meta_title, meta_description')
      .eq('slug', collectionSlug)
      .eq('status', 'published')
      .maybeSingle()
    if (!collection) return {}

    const path = `/resources/${collectionSlug}`
    const title = collection.meta_title || collection.name
    const description =
      collection.meta_description ||
      collection.description ||
      `${collection.name} resources from ${brand.name}.`
    const ogImage = brand.logoUrl || brand.faviconUrl || undefined

    return {
      title,
      description,
      alternates: { canonical: `${baseUrl}${path}` },
      openGraph: {
        title,
        description,
        type: 'website',
        url: `${baseUrl}${path}`,
        siteName: brand.name,
        images: ogImage ? [{ url: ogImage }] : undefined,
      },
      twitter: { card: 'summary_large_image', title, description },
    }
  } catch (err) {
    console.warn('[resource-collection-metadata] failed to build:', err)
    return {}
  }
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
    const baseUrl = `https://${brand.domain}`
    const path = `/newsletters/${collectionSlug}/${editionParam}`
    const url = `${baseUrl}${path}`
    const ogImage = brand.logoUrl ?? brand.faviconUrl ?? undefined

    return {
      title,
      description,
      alternates: {
        canonical: url,
        types: { 'text/markdown': `${baseUrl}/md${path}` },
      },
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

/** Newsletter collection (archive) metadata. */
async function newsletterCollectionMetadata(collectionSlug: string): Promise<Metadata> {
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)
    const baseUrl = `https://${brand.domain}`

    const { data: collection } = await supabase
      .from('newsletters_template_collections')
      .select('name, description')
      .eq('slug', collectionSlug)
      .maybeSingle()
    if (!collection) return {}

    const path = `/newsletters/${collectionSlug}`
    const title = collection.name
    const description = collection.description || `${collection.name} newsletter archive from ${brand.name}.`
    const ogImage = brand.logoUrl ?? brand.faviconUrl ?? undefined

    return {
      title,
      description,
      alternates: { canonical: `${baseUrl}${path}` },
      openGraph: {
        title,
        description,
        type: 'website',
        url: `${baseUrl}${path}`,
        siteName: brand.name,
        images: ogImage ? [{ url: ogImage }] : undefined,
      },
      twitter: { card: 'summary_large_image', title, description },
    }
  } catch (err) {
    console.warn('[newsletter-collection-metadata] failed to build:', err)
    return {}
  }
}

/**
 * Server-rendered JSON-LD for a newsletter edition. The edition page renders its
 * body client-side, so emitting NewsArticle (with articleBody) here puts the
 * content into the initial HTML where non-JS agents and crawlers can read it.
 * Returns null for non-edition paths or unpublished/missing editions.
 */
async function newsletterEditionJsonLd(pathname: string): Promise<object | null> {
  const match = pathname.match(/^\/newsletters\/([^/]+)\/(\d{4}-\d{2}-\d{2}-.+)$/)
  if (!match) return null
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)
    const loaded = await loadPublishedEdition(supabase, match[1], match[2])
    if (!loaded) return null

    const baseUrl = `https://${brand.domain}`
    const collectionUrl = `${baseUrl}/newsletters/${loaded.collection.slug}`
    const pageUrl = `${collectionUrl}/${editionFolderSlug(loaded.edition.edition_date, loaded.edition.title)}`
    const body = editionBodyMarkdown(loaded.blocks, loaded.bricksByBlock)

    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'NewsArticle',
          '@id': `${pageUrl}#article`,
          headline: loaded.edition.title || 'Newsletter edition',
          ...(loaded.edition.preheader ? { description: loaded.edition.preheader } : {}),
          ...(body ? { articleBody: body } : {}),
          datePublished: loaded.edition.created_at || loaded.edition.edition_date,
          dateModified: loaded.edition.updated_at || loaded.edition.edition_date,
          mainEntityOfPage: pageUrl,
          isPartOf: { '@type': 'Periodical', name: loaded.collection.name, url: collectionUrl },
          ...(brand.logoUrl ? { image: brand.logoUrl } : {}),
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Newsletters', item: `${baseUrl}/newsletters` },
            { '@type': 'ListItem', position: 2, name: loaded.collection.name, item: collectionUrl },
            { '@type': 'ListItem', position: 3, name: loaded.edition.title || 'Edition', item: pageUrl },
          ],
        },
      ],
    }
  } catch (err) {
    console.warn('[newsletter-jsonld] failed to build:', err)
    return null
  }
}

/** Server-rendered JSON-LD for a newsletter archive (Blog + ItemList of editions). */
async function newsletterCollectionJsonLd(pathname: string): Promise<object | null> {
  const match = pathname.match(/^\/newsletters\/([^/]+)$/)
  if (!match) return null
  try {
    const brand = await getServerBrandConfig()
    const supabase = await createServerSupabase(brand.id)
    const baseUrl = `https://${brand.domain}`

    const { data: collection } = await supabase
      .from('newsletters_template_collections')
      .select('id, name, slug, description')
      .eq('slug', match[1])
      .maybeSingle()
    if (!collection) return null

    const { data: editions } = await supabase
      .from('newsletters_editions')
      .select('title, edition_date')
      .eq('collection_id', collection.id)
      .eq('status', 'published')
      .order('edition_date', { ascending: false })
      .limit(500)

    const collectionUrl = `${baseUrl}/newsletters/${collection.slug}`
    const items = (editions ?? []).map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${collectionUrl}/${editionFolderSlug(e.edition_date, e.title)}`,
      name: e.title || e.edition_date,
    }))

    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Blog',
          '@id': `${collectionUrl}#blog`,
          name: collection.name,
          ...(collection.description ? { description: collection.description } : {}),
          url: collectionUrl,
          mainEntity: { '@type': 'ItemList', numberOfItems: items.length, itemListElement: items },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Newsletters', item: `${baseUrl}/newsletters` },
            { '@type': 'ListItem', position: 2, name: collection.name, item: collectionUrl },
          ],
        },
      ],
    }
  } catch (err) {
    console.warn('[newsletter-collection-jsonld] failed to build:', err)
    return null
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

  // Server-rendered JSON-LD for client-rendered module pages (newsletter
  // editions) so agents see the structured content in the initial HTML.
  const jsonLd = (await newsletterEditionJsonLd(pathname)) ?? (await newsletterCollectionJsonLd(pathname))

  // Forward both params and searchParams so module pages can read query
  // string values (e.g. /calendars/[slug]/confirm?token=...)
  return (
    <>
      {jsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
      <Suspense fallback={null}>
        <PageComponent
          params={moduleParams}
          searchParams={resolvedSearchParams}
          apiUrl={apiUrl}
        />
      </Suspense>
    </>
  )
}
