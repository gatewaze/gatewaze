import { redirect } from 'next/navigation'
import { getEnabledModules } from '@/lib/modules/enabledModules'
import { getServerBrandConfig, type BrandConfig } from '@/config/brand'
import { getEvents } from '@/lib/events'
import { getBlogPosts, getContentCategories, type BlogPostPreview } from '@/lib/blog'
import { HomepageContent } from '@/components/homepage/HomepageContent'
import { PubHome } from '@/components/public/PubHome'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const modules = await getEnabledModules()
  const { portalNavItems } = modules

  // No content types enabled → show a blank landing page
  if (portalNavItems.length === 0) {
    const brandConfig = await getServerBrandConfig()
    const { trackingHead: _, trackingBody: __, ...clientBrandConfig } = brandConfig
    return (
      <HomepageContent
        brandConfig={clientBrandConfig as BrandConfig}
        navItems={[]}
        upcomingEvents={[]}
        blogPosts={[]}
      />
    )
  }

  // Single content type → redirect directly
  if (portalNavItems.length === 1) {
    redirect(portalNavItems[0].path)
  }

  const brandConfig = await getServerBrandConfig()

  // Fetch preview data for each content type in parallel. Home sections gate
  // on NAV VISIBILITY, not merely `enabled` — a module hidden from the menu is
  // not ready for public consumption, so its preview must not surface here.
  const navVisible = new Set(portalNavItems.map((n) => n.moduleId))
  const showBlog = navVisible.has('blog')
  const [eventData, blogAll, blogCategories] = await Promise.all([
    getEvents(brandConfig.id),
    showBlog ? getBlogPosts(3) : Promise.resolve([] as BlogPostPreview[]),
    showBlog ? getContentCategories() : Promise.resolve([]),
  ])
  // Latest 3 per content category, fetched in parallel, for the filter chips.
  const perCategory = showBlog
    ? await Promise.all(blogCategories.map((c) => getBlogPosts(3, c.value)))
    : []
  const byCategory = Object.fromEntries(blogCategories.map((c, i) => [c.value, perCategory[i] ?? []]))

  // Public Home in the workspace-shell design: upcoming events + latest posts (spec §8.1).
  return (
    <PubHome
      upcomingEvents={(eventData.upcoming ?? []).slice(0, 24) as never[]}
      blogSection={showBlog ? { categories: blogCategories, all: blogAll, byCategory } : undefined}
      storageBucketUrl={brandConfig.storageBucketUrl}
      eventTypes={brandConfig.eventTypes}
    />
  )
}
