import type { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getAppSetting } from '@/lib/appSettings'
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
  // Only reference the privacy policy when this brand actually has one
  // configured (admin -> Settings -> Branding -> Portal -> Legal). Brands like
  // AAIF publish their policies off-site and leave privacy_policy_html empty,
  // so the cookie page's contact section would otherwise dead-link /privacy.
  const hasPrivacyPolicy = Boolean((await getAppSetting('privacy_policy_html'))?.trim())

  return <CookiePolicyPageContent brandConfig={brandConfig} hasPrivacyPolicy={hasPrivacyPolicy} />
}
