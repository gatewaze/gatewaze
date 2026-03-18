'use client'

import { useEffect } from 'react'
import Script from 'next/script'

declare global {
  interface Window {
    fbq?: {
      (command: string, ...args: unknown[]): void
      callMethod?: (...args: unknown[]) => void
      queue?: unknown[]
    }
    _fbq?: typeof window.fbq
  }
}

interface MetaPixelProps {
  pixelId: string
}

/**
 * Meta (Facebook) Pixel Component
 *
 * Loads the Meta advertising pixel and tracks PageView events.
 * This sets the _fbc and _fbp cookies which are captured by our tracking
 * system and sent with conversion events for better attribution.
 *
 * @see https://developers.facebook.com/docs/meta-pixel/implementation
 */
export function MetaPixel({ pixelId }: MetaPixelProps) {
  useEffect(() => {
    // Initialize Meta Pixel if loaded
    if (window.fbq) {
      window.fbq('init', pixelId)
      window.fbq('track', 'PageView')
    }
  }, [pixelId])

  return (
    <Script
      id="meta-pixel"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${pixelId}');
          fbq('track', 'PageView');
        `,
      }}
    />
  )
}
