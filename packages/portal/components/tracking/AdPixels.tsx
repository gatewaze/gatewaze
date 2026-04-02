'use client'

import { RedditPixel } from './RedditPixel'
import { MetaPixel } from './MetaPixel'
import { hasConsentFor } from '@/hooks/useConsent'

interface AdPixelConfig {
  reddit?: {
    pixelId: string
  }
  meta?: {
    pixelId: string
  }
  // Add other platforms as needed
  // google?: { conversionId: string }
}

interface AdPixelsProps {
  config: AdPixelConfig
}

/**
 * AdPixels Component
 *
 * Renders advertising pixels for configured platforms.
 * Only loads pixels if the user has consented to marketing cookies.
 *
 * These pixels set cookies that are captured by our tracking system:
 * - Reddit: _rdt_uuid cookie
 * - Meta: _fbc and _fbp cookies
 */
export function AdPixels({ config }: AdPixelsProps) {
  // Only load ad pixels if user has consented to marketing
  if (!hasConsentFor('marketing')) {
    return null
  }

  return (
    <>
      {config.reddit?.pixelId && (
        <RedditPixel pixelId={config.reddit.pixelId} />
      )}
      {config.meta?.pixelId && (
        <MetaPixel pixelId={config.meta.pixelId} />
      )}
    </>
  )
}
