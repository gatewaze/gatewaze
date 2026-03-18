/**
 * Ad Platform Configuration
 *
 * Defines the tracking parameters and cookies for each supported ad platform.
 * This allows us to capture all relevant tracking data when users click through
 * from ads before redirecting to external registration.
 */

// Click ID parameters that come in the URL from each platform
export const CLICK_ID_PARAMS: Record<string, string> = {
  meta: 'fbclid', // Facebook/Instagram click ID
  google: 'gclid', // Google Ads click ID
  reddit: 'rdt_cid', // Reddit click ID
  bing: 'msclkid', // Microsoft/Bing click ID
  linkedin: 'li_fat_id', // LinkedIn click ID
  tiktok: 'ttclid', // TikTok click ID
}

// Platform cookies that we should capture
export const PLATFORM_COOKIES: Record<string, string[]> = {
  meta: ['_fbc', '_fbp'], // Facebook click and browser cookies
  google: ['_gcl_aw', '_gcl_dc'], // Google Ads cookies
  reddit: ['_rdt_uuid'], // Reddit user ID cookie
  bing: ['_uetmsclkid'], // Bing UET cookie
  tiktok: ['_ttp'], // TikTok cookie
  linkedin: [], // LinkedIn doesn't use cookies the same way
}

// UTM parameters (universal across all platforms)
export const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

// All click ID param names for easy iteration
export const ALL_CLICK_ID_PARAMS = Object.values(CLICK_ID_PARAMS)

// All cookie names for easy iteration
export const ALL_PLATFORM_COOKIES = Object.values(PLATFORM_COOKIES).flat()

/**
 * Get the platform name from a click ID parameter
 */
export function getPlatformFromClickId(clickIdParam: string): string | undefined {
  return Object.entries(CLICK_ID_PARAMS).find(([, param]) => param === clickIdParam)?.[0]
}

/**
 * Get the platform name from a cookie name
 */
export function getPlatformFromCookie(cookieName: string): string | undefined {
  return Object.entries(PLATFORM_COOKIES).find(([, cookies]) => cookies.includes(cookieName))?.[0]
}
