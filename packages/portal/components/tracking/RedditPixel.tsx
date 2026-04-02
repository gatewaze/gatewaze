'use client'

import { useEffect } from 'react'
import Script from 'next/script'

declare global {
  interface Window {
    rdt?: {
      (command: string, ...args: unknown[]): void
      callQueue?: unknown[]
      sendEvent?: (...args: unknown[]) => void
    }
  }
}

interface RedditPixelProps {
  pixelId: string
}

/**
 * Reddit Pixel Component
 *
 * Loads the Reddit advertising pixel and tracks PageVisit events.
 * This also sets the _rdt_uuid cookie which is captured by our tracking
 * system and sent with conversion events for better attribution.
 *
 * @see https://business.reddithelp.com/s/article/Install-the-Reddit-Pixel-on-your-website
 */
export function RedditPixel({ pixelId }: RedditPixelProps) {
  useEffect(() => {
    // Initialize Reddit Pixel if loaded
    if (window.rdt) {
      window.rdt('init', pixelId)
      window.rdt('track', 'PageVisit')
    }
  }, [pixelId])

  return (
    <Script
      id="reddit-pixel"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `
          !function(w,d){
            if(!w.rdt){
              var p=w.rdt=function(){
                p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)
              };
              p.callQueue=[];
              var t=d.createElement("script");
              t.src="https://www.redditstatic.com/ads/pixel.js";
              t.async=!0;
              var s=d.getElementsByTagName("script")[0];
              s.parentNode.insertBefore(t,s);
            }
          }(window,document);
          rdt('init','${pixelId}');
          rdt('track','PageVisit');
        `,
      }}
    />
  )
}
