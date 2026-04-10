import { Suspense } from 'react'
import { getServerBrand, getBrandConfigById } from '@/config/brand'
import { OpenRsvpClient } from '@/components/rsvp/OpenRsvpClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ code: string }>
}

/**
 * Self-serve RSVP landing page reached via short link /o/{code}.
 *
 * Unlike the party-scoped /rsvp/{code} flow, there is no pre-existing party
 * here. The page loads the open link config (event, sub-events, follow-up
 * questions) and lets any visitor register themselves (optionally plus
 * additional party members) and submit an RSVP which creates a new party
 * server-side.
 */
export default async function OpenRsvpPage({ params }: Props) {
  const { code } = await params
  const brand = await getServerBrand()
  const brandConfig = await getBrandConfigById(brand)

  return (
    <div
      className="min-h-screen flex items-start justify-center p-4 py-10"
      style={{ backgroundColor: brandConfig.secondaryColor || '#0a0a0a' }}
    >
      <div className="w-full max-w-2xl">
        <Suspense fallback={<div className="py-12 text-center text-gray-300">Loading...</div>}>
          <OpenRsvpClient
            code={code}
            primaryColor={brandConfig.primaryColor}
            brandName={brandConfig.name}
          />
        </Suspense>
      </div>
    </div>
  )
}
