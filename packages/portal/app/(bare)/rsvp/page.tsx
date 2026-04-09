import { Suspense } from 'react'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { RsvpPageClient } from '@/components/rsvp/RsvpPageClient'

export const dynamic = 'force-dynamic'

export default async function RsvpPage() {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: brandConfig.secondaryColor || '#0a0a0a' }}>
      <div className="w-full max-w-lg">
        <Suspense fallback={<div className="py-12 text-center text-gray-500">Loading your invitation...</div>}>
          <RsvpPageClient primaryColor={brandConfig.primaryColor} brandName={brandConfig.name} />
        </Suspense>
      </div>
    </div>
  )
}
