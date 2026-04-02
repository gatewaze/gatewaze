import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getAppSetting } from '@/lib/appSettings'
import { DoNotSellPageContent } from './DoNotSellPageContent'

// Force dynamic rendering - this page uses headers() for brand detection
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brandConfig = await getBrandConfigById(await getServerBrand())

  return {
    title: 'Do Not Sell My Info',
    description: `Exercise your privacy rights with ${brandConfig.name}`,
    openGraph: {
      title: `Do Not Sell My Info - ${brandConfig.name}`,
      description: `Exercise your privacy rights with ${brandConfig.name}`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `Do Not Sell My Info - ${brandConfig.name}`,
      description: `Exercise your privacy rights with ${brandConfig.name}`,
    },
  }
}

export default async function DoNotSellPage() {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)
  const customHtml = await getAppSetting('do_not_sell_html')

  return <DoNotSellPageContent brandConfig={brandConfig} brand={brand} customHtml={customHtml} />
}
