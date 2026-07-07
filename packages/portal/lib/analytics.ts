/**
 * Portal analytics — thin re-export of the platform tracking SDK so the
 * portal's many existing `@/lib/analytics` import sites keep working.
 *
 * All semantics live in @gatewaze/tracking/client: fan-out to
 * window.dataLayer / window.analytics (Segment) / window.umami
 * (first-party store), plus the `gw_aid` anonymous-id cookie that every
 * event and identify call carries.
 */

export {
  trackEvent,
  trackPageView,
  identifyUser,
  moduleFromPath,
  ensureAnonymousId,
  getAnonymousId,
} from '@gatewaze/tracking/client'
