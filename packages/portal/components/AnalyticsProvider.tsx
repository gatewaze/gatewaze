'use client'

/**
 * Analytics provider — initializes dataLayer for GTM-compatible tracking.
 * The actual analytics scripts are injected via admin-configured tracking code
 * in the layout's <head> and <body>.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
