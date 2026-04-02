import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getAppSetting } from '@/lib/appSettings'
import { TermsPageContent } from './TermsPageContent'

// Force dynamic rendering - this page uses headers() for brand detection
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brandConfig = await getBrandConfigById(await getServerBrand())

  return {
    title: 'Terms of Service',
    description: `Terms of Service for ${brandConfig.name}`,
    openGraph: {
      title: `Terms of Service - ${brandConfig.name}`,
      description: `Terms of Service for ${brandConfig.name}`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `Terms of Service - ${brandConfig.name}`,
      description: `Terms of Service for ${brandConfig.name}`,
    },
  }
}

export default async function TermsOfService() {
  const brandConfig = await getBrandConfigById(await getServerBrand())
  const customHtml = await getAppSetting('terms_of_service_html')

  return <TermsPageContent brandConfig={brandConfig} customHtml={customHtml} />
}
