import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { CookiePolicyPageContent } from './CookiePolicyPageContent'

// Force dynamic rendering - this page uses headers() for brand detection
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brandConfig = await getBrandConfigById(await getServerBrand())

  return {
    title: 'Cookie Policy',
    description: `Cookie Policy for ${brandConfig.name}`,
    openGraph: {
      title: `Cookie Policy - ${brandConfig.name}`,
      description: `Cookie Policy for ${brandConfig.name}`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `Cookie Policy - ${brandConfig.name}`,
      description: `Cookie Policy for ${brandConfig.name}`,
    },
  }
}

export default async function CookiePolicy() {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return <CookiePolicyPageContent brandConfig={brandConfig} brandId={brand} />
}
