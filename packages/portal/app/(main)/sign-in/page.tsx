import type { Metadata } from 'next'
import { getServerBrandConfig } from '@/config/brand'
import { SignInPageContent } from './SignInPageContent'

// Force dynamic rendering - this page uses headers() for brand detection
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brandConfig = await getServerBrandConfig()
  return {
    title: `Sign In - ${brandConfig.name}`,
    description: `Sign in to your ${brandConfig.name} account`,
    openGraph: {
      title: `Sign In - ${brandConfig.name}`,
      description: `Sign in to your ${brandConfig.name} account`,
      type: 'website',
      siteName: brandConfig.name,
    },
    twitter: {
      card: 'summary',
      title: `Sign In - ${brandConfig.name}`,
      description: `Sign in to your ${brandConfig.name} account`,
    },
  }
}

export default async function SignInPage() {
  const brandConfig = await getServerBrandConfig()

  return <SignInPageContent brandConfig={brandConfig} />
}
