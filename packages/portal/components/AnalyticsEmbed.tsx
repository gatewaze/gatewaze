/**
 * First-party analytics embed (analytics module).
 *
 * Server component: discovers the brand's active `portal` tracking property
 * from the analytics module's public /a/portal-config endpoint and injects
 *   1. the Umami tracker (served same-API at /a/script.js) — auto-tracks page
 *      views incl. SPA navigations into the FIRST-PARTY store, and
 *   2. the property's dimensions pixel (/a/<id>.js), which also exposes
 *      window.umami for lib/analytics.ts to fan custom events into.
 *
 * Self-gating: when the analytics module is disabled or no portal property is
 * provisioned the config fetch 404s and nothing renders — vendor scripts via
 * tracking_head/tracking_body are unaffected either way.
 */

const API_URL =
  process.env.GATEWAZE_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  ''

export async function AnalyticsEmbed() {
  if (!API_URL) return null
  let propertyId: string | null = null
  try {
    const res = await fetch(`${API_URL}/a/portal-config`, { next: { revalidate: 300 } })
    if (res.ok) {
      const cfg = (await res.json()) as { property_id?: string }
      propertyId = cfg.property_id ?? null
    }
  } catch {
    // API unreachable → skip silently; tracking degrades to vendor-only.
  }
  if (!propertyId) return null

  return (
    <>
      <script
        async
        defer
        src={`${API_URL}/a/script.js`}
        data-website-id={propertyId}
        data-host-url={API_URL}
      />
      <script async defer src={`${API_URL}/a/${propertyId}.js`} />
    </>
  )
}

export default AnalyticsEmbed
