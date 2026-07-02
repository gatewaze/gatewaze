import { Metadata } from 'next'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { getEnabledModules } from '@/lib/modules/enabledModules'
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
  const modules = await getEnabledModules()

  return (
    <ProfileContent
      brandConfig={brandConfig}
      enabledModuleIds={[...modules.enabledIds]}
      enabledFeatures={[...modules.enabledFeatures]}
    />
  )
}
