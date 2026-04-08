import { createServerSupabase } from '@/lib/supabase/server'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { RsvpPageClient } from './RsvpPageClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ identifier: string }>
}

export default async function RsvpPage({ params }: Props) {
  const { identifier } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return (
    <RsvpPageClient
      eventIdentifier={identifier}
      primaryColor={brandConfig.primaryColor}
      brandName={brandConfig.name}
    />
  )
}
