import { redirect } from 'next/navigation'
import { getEnabledModules, isModuleEnabled } from '@/lib/modules/enabledModules'
import { getServerBrandConfig } from '@/config/brand'
import { getEvents } from '@/lib/events'
import { getBlogPosts } from '@/lib/blog'
import { HomepageContent } from '@/components/homepage/HomepageContent'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const modules = await getEnabledModules()
  const { portalNavItems } = modules

  // Single content type → redirect directly (preserves current behavior)
  if (portalNavItems.length <= 1) {
    redirect(portalNavItems[0]?.path || '/events/upcoming')
  }

  const brandConfig = await getServerBrandConfig()

  // Fetch preview data for each enabled content type in parallel
  const [eventData, blogPosts] = await Promise.all([
    getEvents(brandConfig.id),
    isModuleEnabled(modules, 'blog') ? getBlogPosts(3) : Promise.resolve([]),
  ])

  // Serialize brand config for client (strip server-only fields)
  const { trackingHead: _, trackingBody: __, ...clientBrandConfig } = brandConfig

  return (
    <HomepageContent
      brandConfig={clientBrandConfig as any}
      navItems={portalNavItems}
      upcomingEvents={eventData.upcoming.slice(0, 4)}
      blogPosts={blogPosts}
    />
  )
}
