'use client'

import Script from 'next/script'

/**
 * Loads the cookie consent script.
 * data-brand is set on <html> by the server layout and read by the consent script directly.
 */
export function CookieConsentLoader() {
  return (
    <Script
      src="/js/cookieconsent/custom-consent.js?v=6"
      strategy="afterInteractive"
    />
  )
}
