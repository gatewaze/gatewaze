'use client'

import { useSearchParams } from 'next/navigation'
import { PortalButton } from '@/components/ui/PortalButton'

interface Props {
  identifier: string
  primaryColor: string
}

export function RegisterButton({ identifier, primaryColor }: Props) {
  const searchParams = useSearchParams()

  // Build /e/ URL with all original search params forwarded (rdt_cid, utm_*, etc.)
  const eUrl = `/e/${identifier}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`

  return (
    <PortalButton
      variant="primary"
      primaryColor={primaryColor}
      href={eUrl}
      glow
      className="w-full lg:w-auto justify-center shadow-2xl"
    >
      More details
    </PortalButton>
  )
}
