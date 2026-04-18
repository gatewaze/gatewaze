import { Suspense } from 'react'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { findEventModulePage } from '@/lib/modules/generated-event-pages'

export const dynamic = 'force-dynamic'

export default async function RsvpPage() {
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  // Load the RSVP page from the event-invites module registry — same
  // source of truth as the /events/[id]/rsvp route. No event context
  // here; the client uses the token from the URL/localStorage directly.
  const modulePage = findEventModulePage('rsvp')
  if (!modulePage) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-gray-500">RSVP module is not enabled for this brand.</p>
      </div>
    )
  }
  const { default: RsvpPageClient } = await modulePage.component()

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: brandConfig.secondaryColor || '#0a0a0a' }}>
      <div className="w-full max-w-lg">
        <Suspense fallback={<div className="py-12 text-center text-gray-500">Loading your invitation...</div>}>
          <RsvpPageClient eventIdentifier="" primaryColor={brandConfig.primaryColor} brandName={brandConfig.name} />
        </Suspense>
      </div>
    </div>
  )
}
