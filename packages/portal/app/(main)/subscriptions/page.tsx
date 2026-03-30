import { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { SubscriptionContent } from './SubscriptionContent'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return {
    title: `Email Preferences - ${brandConfig.name}`,
    description: `Manage your email subscription preferences on ${brandConfig.name}`,
    openGraph: {
      title: `Email Preferences - ${brandConfig.name}`,
      description: `Manage your email subscription preferences on ${brandConfig.name}`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `Email Preferences - ${brandConfig.name}`,
      description: `Manage your email subscription preferences on ${brandConfig.name}`,
    },
  }
}

export default async function SubscriptionsPage() {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return <SubscriptionContent brandConfig={brandConfig} />
}
