import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getAppSetting } from '@/lib/appSettings'
import { PrivacyPageContent } from './PrivacyPageContent'

// Force dynamic rendering - this page uses headers() for brand detection
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brandConfig = await getBrandConfigById(await getServerBrand())

  return {
    title: 'Privacy Policy',
    description: `Privacy Policy for ${brandConfig.name}`,
    openGraph: {
      title: `Privacy Policy - ${brandConfig.name}`,
      description: `Privacy Policy for ${brandConfig.name}`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `Privacy Policy - ${brandConfig.name}`,
      description: `Privacy Policy for ${brandConfig.name}`,
    },
  }
}

export default async function PrivacyPolicy() {
  const brandConfig = await getBrandConfigById(await getServerBrand())
  const customHtml = await getAppSetting('privacy_policy_html')

  return <PrivacyPageContent brandConfig={brandConfig} customHtml={customHtml} />
}
