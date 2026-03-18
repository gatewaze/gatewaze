import type { MetadataRoute } from 'next'
import { getServerBrandConfig } from '@/config/brand'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const brandConfig = await getServerBrandConfig()

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/auth/', '/profile/', '/sign-in/'],
    },
    sitemap: `https://${brandConfig.domain}/sitemap.xml`,
  }
}
