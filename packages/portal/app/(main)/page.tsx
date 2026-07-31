import { redirect } from 'next/navigation'
import { getEnabledModules } from '@/lib/modules/enabledModules'
import { getServerBrandConfig, type BrandConfig } from '@/config/brand'
import { getEvents } from '@/lib/events'
import { getBlogPosts, getContentCategories, type BlogPostPreview } from '@/lib/blog'
import { getViewableDraftModuleIds } from '@/lib/modules/draftAccess'
import { createServerSupabase } from '@/lib/supabase/server'
import { sanitizeHtml } from '@/lib/sanitize-html'
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
  // Draft modules count as visible for authorised viewers only, so previewing
  // admins see the full home-page experience.
  const navVisible = new Set(portalNavItems.map((n) => n.moduleId))
  const draftViewable = await getViewableDraftModuleIds()
  const showBlog = navVisible.has('blog') || draftViewable.has('blog')
  const [eventData, blogAll, blogCategories, heroSettings] = await Promise.all([
    getEvents(brandConfig.id),
    showBlog ? getBlogPosts(3) : Promise.resolve([] as BlogPostPreview[]),
    showBlog ? getContentCategories() : Promise.resolve([]),
    // Brand-editable home intro (Settings → Branding → Portal → Home).
    (async () => {
      const supabase = await createServerSupabase(brandConfig.id)
      const { data } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', ['portal_home_heading', 'portal_home_intro_html'])
      const get = (k: string) => data?.find((r) => r.key === k)?.value?.trim() || null
      return { heading: get('portal_home_heading'), introHtml: sanitizeHtml(get('portal_home_intro_html')) || null }
    })(),
  ])
  // Latest 3 per content category, fetched in parallel, for the filter chips.
  const perCategory = showBlog
    ? await Promise.all(blogCategories.map((c) => getBlogPosts(3, c.value)))
    : []
  const byCategory = Object.fromEntries(blogCategories.map((c, i) => [c.value, perCategory[i] ?? []]))

  // Public Home in the workspace-shell design: upcoming events + latest posts (spec §8.1).
  return (
    <PubHome
      hero={heroSettings.heading || heroSettings.introHtml ? heroSettings : undefined}
      upcomingEvents={(eventData.upcoming ?? []).slice(0, 24) as never[]}
      blogSection={showBlog ? { categories: blogCategories, all: blogAll, byCategory, primaryColor: brandConfig.primaryColor } : undefined}
      storageBucketUrl={brandConfig.storageBucketUrl}
      eventTypes={brandConfig.eventTypes}
    />
  )
}
