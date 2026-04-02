import { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { ProfileContent } from './ProfileContent'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return {
    title: `My Profile - ${brandConfig.name}`,
    description: `Manage your profile on ${brandConfig.name}`,
    openGraph: {
      title: `My Profile - ${brandConfig.name}`,
      description: `Manage your profile on ${brandConfig.name}`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `My Profile - ${brandConfig.name}`,
      description: `Manage your profile on ${brandConfig.name}`,
    },
  }
}

export default async function ProfilePage() {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return <ProfileContent brandConfig={brandConfig} />
}
