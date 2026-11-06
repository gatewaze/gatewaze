/**
 * LF Segment wrapper (lfx-segment-analytics) helpers.
 *
 * The Linux Foundation identifies people in Segment the same way in every
 * LFX app: each app loads LF's wrapper script and hands it the Auth0 user.
 * The wrapper picks the userId (the CDP member UUID from the
 * `http://lfx.dev/claims/uuid` claim) and the traits itself. The portal
 * loads the same script so its identify / page calls match LFX exactly.
 * See LFX One's apps/lfx-one/src/app/shared/services/segment.service.ts.
 *
 * Pure functions only, so they can be tested without the script.
 */

/** Claim names the wrapper's identifyAuth0User() reads. */
export const LF_USERNAME_CLAIM = 'https://sso.linuxfoundation.org/claims/username'
export const LF_CDP_UUID_CLAIM = 'http://lfx.dev/claims/uuid'

export interface LfxSegmentAnalytics {
  initWithEventSanitizer: (sanitizer: (event: SegmentEvent) => SegmentEvent | null, writeKey?: string) => Promise<void>
  identifyAuth0User: (user: Record<string, unknown>) => void | Promise<void>
  page: (name?: string, properties?: Record<string, unknown>) => void | Promise<void>
  track: (event: string, properties?: Record<string, unknown>) => void | Promise<void>
  reset: () => void | Promise<void>
}

export interface SegmentEvent {
  type: string
  messageId: string
  properties?: Record<string, unknown>
  context?: { page?: Record<string, unknown>; [key: string]: unknown }
  [key: string]: unknown
}

/** Only utm_* parameters survive. Everything else in a portal URL (auth
 * codes, invite and RSVP tokens, the sign-in session in the hash) stays out
 * of Segment. */
function keptParams(params: URLSearchParams): string {
  const kept = new URLSearchParams()
  params.forEach((value, key) => {
    if (key.toLowerCase().startsWith('utm_')) kept.append(key, value)
  })
  const s = kept.toString()
  return s ? `?${s}` : ''
}

/** First path segments whose next segment is an invite / RSVP / tracking
 * code. Those codes act as credentials (they open someone's invite), so the
 * segment after them is masked. */
const TOKEN_PATH_PREFIXES = new Set(['event-invites', 'rsvp', 'invite', 'i', 'u', 'o', 'r'])

function maskTokenPath(pathname: string): string {
  const parts = pathname.split('/')
  if (parts.length > 2 && TOKEN_PATH_PREFIXES.has(parts[1].toLowerCase()) && parts[2]) {
    parts[2] = ':token'
  }
  return parts.join('/')
}

/** Strips the hash and every non-utm query parameter from a URL, and masks
 * invite codes in the path. Relative URLs stay relative. Unparsable input
 * becomes an empty string. */
export function cleanUrl(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value
  try {
    const relative = value.startsWith('/') && !value.startsWith('//')
    const u = new URL(value, 'https://placeholder.invalid')
    const rest = keptParams(u.searchParams)
    const path = maskTokenPath(u.pathname)
    return relative ? `${path}${rest}` : `${u.origin}${path}${rest}`
  } catch {
    return ''
  }
}

/** Same rule for a bare query string (`?a=1&utm_source=x`). */
export function cleanSearch(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return keptParams(new URLSearchParams(value.startsWith('?') ? value.slice(1) : value))
}

/** Runs on every event the wrapper sends, including its own first page
 * view. Changes only URL-shaped fields; never type or messageId. */
export function sanitizeSegmentEvent(event: SegmentEvent): SegmentEvent {
  for (const bag of [event.properties, event.context?.page]) {
    if (!bag || typeof bag !== 'object') continue
    for (const key of ['url', 'referrer', 'href']) {
      if (key in bag) bag[key] = cleanUrl(bag[key])
    }
    if ('search' in bag) bag.search = cleanSearch(bag.search)
    if (typeof bag.path === 'string') bag.path = cleanUrl(bag.path)
  }
  return event
}

interface PortalUser {
  email?: string | null
  user_metadata?: Record<string, unknown> | null
  app_metadata?: Record<string, unknown> | null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/**
 * Builds the Auth0-claims-shaped object identifyAuth0User() expects from a
 * portal session user. Returns null when there is no email (the wrapper
 * refuses to identify without one).
 *
 * The CDP UUID is read from app_metadata only. The LFID callback writes it
 * there with the service role; user_metadata is writable by the user, so a
 * value there could claim someone else's Segment profile.
 */
export function auth0ClaimsForUser(user: PortalUser): Record<string, unknown> | null {
  const email = str(user.email)
  if (!email) return null
  const meta = user.user_metadata ?? {}
  const appMeta = user.app_metadata ?? {}
  const claims: Record<string, unknown> = { email }
  const name = str(meta.full_name) ?? str(meta.name)
  if (name) claims.name = name
  const given = str(meta.given_name) ?? str(meta.first_name)
  if (given) claims.given_name = given
  const family = str(meta.family_name) ?? str(meta.last_name)
  if (family) claims.family_name = family
  const picture = str(meta.avatar_url)
  if (picture) claims.picture = picture
  // The wrapper uses the username to decide whether to keep a cached id, and
  // user_metadata is user-writable. Only send it for LFID sign-ins, where
  // the callback wrote it (provider lives in server-only app_metadata).
  const username = str(meta.lfid_username)
  if (username && appMeta.provider === 'lfid') claims[LF_USERNAME_CLAIM] = username
  const uuid = str(appMeta.cdp_uuid)
  if (uuid) claims[LF_CDP_UUID_CLAIM] = uuid
  return claims
}

/** Portal SDK events that the wrapper already covers (page views and
 * identify) are not forwarded as track calls. */
const NOT_FORWARDED = new Set(['page_view', 'identify'])

/** Which in-page `analytics` CustomEvents become wrapper track() calls. */
export function forwardableTrack(detail: unknown): { event: string; properties?: Record<string, unknown> } | null {
  if (!detail || typeof detail !== 'object') return null
  const { event, properties } = detail as { event?: unknown; properties?: unknown }
  if (typeof event !== 'string' || !event || event.length > 120 || NOT_FORWARDED.has(event)) return null
  const props = properties && typeof properties === 'object' && !Array.isArray(properties)
    ? sanitizeSegmentEvent({ type: 'track', messageId: '', properties: { ...(properties as Record<string, unknown>) } }).properties
    : undefined
  return { event, properties: props }
}

/** Only https script URLs on LF's own host are loaded. The URL comes from
 * deploy config, but this keeps a typo or a bad values change from
 * injecting a script from anywhere else. */
export function isAllowedWrapperUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && u.hostname === 'lfx-segment.platform.linuxfoundation.org'
  } catch {
    return false
  }
}

/** Deploy config for the wrapper, read at request time on the server.
 * Returns null when it is not configured (or not an LF URL), in which case
 * the portal keeps the server relay's Segment leg instead. */
export function lfxSegmentConfig(env: Record<string, string | undefined> = process.env): { src: string; writeKey?: string } | null {
  const src = env.LFX_SEGMENT_CDN_URL?.trim()
  if (!isAllowedWrapperUrl(src)) return null
  const writeKey = env.LFX_SEGMENT_WRITE_KEY?.trim()
  return writeKey ? { src, writeKey } : { src }
}

/** The write key for the /api/t browser relay's Segment leg. Off when the
 * browser sends through LF's wrapper: the relay's copies of those browser
 * events would double them under a second id. Server-originated events keep
 * SEGMENT_WRITE_KEY (see getServerTracker). */
export function relaySegmentWriteKey(env: Record<string, string | undefined> = process.env): string | undefined {
  if (lfxSegmentConfig(env)) return undefined
  return env.SEGMENT_WRITE_KEY || undefined
}
