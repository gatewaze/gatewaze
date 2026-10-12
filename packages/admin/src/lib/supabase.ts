import { createClient, SupabaseClient } from '@supabase/supabase-js'

import {
  createHostAuth,
  HOST_SESSION_TOKEN,
  hostSessionFetch,
  signInUrl,
  type HostAuth,
  type HostStatus,
} from './hostSession'

let supabaseClient: SupabaseClient | null = null
// Set only by configureEmbedSupabase(), before getSupabase() ever runs.
// Lets an embedded mount use its own Supabase project config and a
// distinct localStorage key so its session never collides with (or gets
// read/cleared by) a host page or a standalone admin session sharing the
// same origin.
let embedOverride: { url: string; anonKey: string; storageKey: string } | null = null
// Set only by configureHostSession(), the embedded host-session counterpart
// of embedOverride. The two are mutually exclusive.
let hostOverride: HostSessionConfig | null = null
// The auth shim, present only when the client was built in host-session mode.
let hostAuth: HostAuth | null = null

export type AuthMode = 'local' | 'host-session'
// The mode the singleton was built in; fixed from then on.
let builtMode: AuthMode | null = null
let warnedAuthMode = false

export interface HostSessionConfig {
  /** Absolute, same-origin base URL that proxies /rest/v1, /storage/v1, /functions/v1 and /realtime/v1. */
  baseUrl: string
  anonKey: string
  /**
   * Session holder's "who am I" route (GET, with the cookie): 200 { user } signed in as an admin; 401 signed
   * out (with `x-gw-session: expired` when the cookie's session is gone); 403
   * { email? } signed in but not an admin; 503 { error: 'admin_check_pending' }
   * with Retry-After (seconds) while the admin check is still running; 503
   * { error: 'session_unavailable' } when the session store cannot answer.
   * Any other answer is treated as unavailable, never as a sign-out.
   */
  meUrl: string
  /** Session holder's sign-out route (POST). */
  logoutUrl: string
  /** The host's hook for a lost session or a sign-in request. */
  onSignedOut?: () => void
}

/**
 * Host-session mode is opt-in. Only the exact value 'host-session' (or an
 * embed that called configureHostSession) selects it; anything else,
 * including unset, keeps the localStorage client exactly as it was.
 */
export function resolveAuthMode(): AuthMode {
  if (builtMode) return builtMode
  if (hostOverride) return 'host-session'
  // An embed configured for localStorage never follows the page's env.
  if (embedOverride) return 'local'
  const configured = import.meta.env.VITE_AUTH_MODE
  if (configured === 'host-session') return 'host-session'
  if (configured && configured !== 'local' && !warnedAuthMode) {
    warnedAuthMode = true
    console.warn(`[supabase] Unrecognised VITE_AUTH_MODE "${configured}"; using local`)
  }
  return 'local'
}

type AuthFlowType = 'implicit' | 'pkce'

// Implicit stays the default because auth-js rejects a token hash outright
// under PKCE, and a magic link opened in a different browser from the one
// that requested it cannot complete PKCE either (the code verifier lives in
// the requesting browser). Only a deployment whose every sign-in returns
// with `?code=` opts into PKCE, per environment.
function resolveFlowType(): AuthFlowType {
  const configured = import.meta.env.VITE_SUPABASE_FLOW_TYPE
  if (configured === 'pkce') return 'pkce'
  if (configured && configured !== 'implicit') {
    console.warn(`[supabase] Unrecognised VITE_SUPABASE_FLOW_TYPE "${configured}"; using implicit`)
  }
  return 'implicit'
}

function createLocalClient(): SupabaseClient {
  const url = embedOverride?.url ?? import.meta.env.VITE_SUPABASE_URL
  const anonKey = embedOverride?.anonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  const storageKey = embedOverride?.storageKey ?? 'gatewaze-admin-auth-token'
  // The embed receives its session from the host and never runs a redirect
  // flow, so it must not read the runtime env (the host page has none).
  const flowType: AuthFlowType = embedOverride ? 'implicit' : resolveFlowType()

  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType,
      storage: window.localStorage,
      storageKey,
    },
  })
}

function createHostSessionClient(): SupabaseClient {
  const baseUrl = hostOverride?.baseUrl ?? window.location.origin
  const anonKey = hostOverride?.anonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!anonKey) {
    throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable')
  }

  // Standalone, a public URL that is just this origin means saved image URLs
  // and OAuth redirect URIs will point at the admin. Say so once.
  if (!hostOverride) {
    const publicUrl = getSupabasePublicUrl().replace(/\/+$/, '')
    if (!publicUrl || publicUrl === baseUrl.replace(/\/+$/, '')) {
      warnOnce(
        'public-url-is-base',
        '[supabase] VITE_SUPABASE_PUBLIC_URL is unset or equals the admin origin in host-session mode; public storage URLs and OAuth redirect URIs will point at the admin',
      )
    }
  }

  const auth = createHostAuth({
    meUrl: hostOverride?.meUrl ?? '/bff/me',
    logoutUrl: hostOverride?.logoutUrl ?? '/bff/logout',
    anonKey,
    getHostHook: () => hostOverride?.onSignedOut,
    embedded: hostOverride !== null,
  })
  hostAuth = auth

  const client = createClient(baseUrl, anonKey, {
    // The top-level accessToken option (supabase-js >= 2.45; checked against
    // the installed 2.98) is used instead of the PoC's
    // `realtime: { accessToken }`. It feeds the same callback to Realtime at
    // construction (supabase-js authenticates Realtime as soon as the client
    // exists, so it cannot be set later) and also to REST, Storage and
    // Functions, so every request carries the placeholder. It also stops
    // supabase-js from building a GoTrue client at all, so nothing can read
    // or write a session in browser storage. In exchange the raw client's
    // `auth` throws on access, which is why the client is wrapped below.
    accessToken: async () => HOST_SESSION_TOKEN,
    global: { fetch: hostSessionFetch(() => auth.signedOut()) },
  })

  // Built on first use, so the wrapper only exists if storage is touched.
  let storage: SupabaseClient['storage'] | null = null

  // Unlike the PoC, getSupabase() itself returns the wrapped client, not only
  // the `supabase` export: code that calls getSupabase().auth (the sign-in
  // page, the LFID module's start-sign-in helper) must reach the shim too,
  // and the raw client's `auth` throws under the accessToken option.
  // Reflect.get with the target as receiver keeps supabase-js getters (such
  // as `functions`) running against the real client, not the proxy.
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'auth') return auth
      if (prop === 'storage') return (storage ??= wrapStoragePublicUrls(target.storage, baseUrl))
      return Reflect.get(target, prop, target)
    },
  })
}

/**
 * In host-session mode the client's base URL is the admin (or host) origin,
 * so storage.from(bucket).getPublicUrl() would hand out URLs on that origin.
 * Modules store those URLs (competition winner images, resource covers,
 * newsletter images) and show them outside the admin, so they are rewritten
 * to the real Supabase URL. Only getPublicUrl changes: uploads, downloads and
 * signed URLs keep going through the session holder.
 */
function wrapStoragePublicUrls(storage: SupabaseClient['storage'], baseUrl: string): SupabaseClient['storage'] {
  const localPrefix = new URL('storage/v1/', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href

  const rewrite = (url: string): string => {
    const publicBase = getSupabasePublicUrl().replace(/\/+$/, '')
    if (!publicBase || !url.startsWith(localPrefix)) return url
    return `${publicBase}/storage/v1/${url.slice(localPrefix.length)}`
  }

  // Methods are bound to the real object, as the `supabase` export does, so
  // storage-js never sees the proxy as `this`.
  const bindTo = <T extends object>(target: T, prop: string | symbol) => {
    const value = Reflect.get(target, prop, target)
    return typeof value === 'function' ? value.bind(target) : value
  }

  return new Proxy(storage, {
    get(target, prop) {
      if (prop !== 'from') return bindTo(target, prop)
      return (bucket: string) => {
        const api = target.from(bucket)
        return new Proxy(api, {
          get(apiTarget, apiProp) {
            if (apiProp !== 'getPublicUrl') return bindTo(apiTarget, apiProp)
            return (...args: Parameters<typeof apiTarget.getPublicUrl>) => {
              const result = apiTarget.getPublicUrl(...args)
              return { ...result, data: { ...result.data, publicUrl: rewrite(result.data.publicUrl) } }
            }
          },
        })
      }
    },
  })
}

function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient
  const mode = resolveAuthMode()
  supabaseClient = mode === 'host-session' ? createHostSessionClient() : createLocalClient()
  builtMode = mode
  return supabaseClient
}

/**
 * Configure the lazy Supabase singleton for an embedded mount. Must be
 * called before anything touches `supabase`/`getSupabase()` (the embed
 * entry point calls this first, ahead of any provider mount).
 *
 * Idempotent for an IDENTICAL configuration, and throws only when the
 * requested configuration differs from the one already in effect.
 *
 * The original version threw whenever a client existed at all, on the
 * assumption of "one live mount per page". That holds for a standalone
 * page, but not for a host that mounts the embed inside its own router:
 * leaving the embed's subtree unmounts React and drops the host's
 * component, while this module stays evaluated with its client intact.
 * Re-entering then called mount() again and threw, so navigating away
 * from newsletters and back showed "The embedded admin module couldn't
 * be loaded" — reported from the first host integration, and reproducible every time.
 *
 * The hazard the guard exists for is real but narrower than the original
 * check: a second mount asking for a DIFFERENT project or storage key
 * would silently strand callers on the first mount's client, because the
 * singleton is already built and this only sets the override used at
 * construction. That case still throws.
 */
export function configureEmbedSupabase(options: {
  url: string
  anonKey: string
  storageKeySuffix?: string
}): void {
  if (hostOverride) {
    throw new Error('configureEmbedSupabase() called after configureHostSession(); an embed uses one or the other')
  }

  const requested = {
    url: options.url,
    anonKey: options.anonKey,
    storageKey: `gatewaze-admin-auth-token-${options.storageKeySuffix || 'host_embed'}`,
  }

  if (supabaseClient) {
    const sameAsActive =
      embedOverride !== null &&
      embedOverride.url === requested.url &&
      embedOverride.anonKey === requested.anonKey &&
      embedOverride.storageKey === requested.storageKey

    if (sameAsActive) {
      // Re-mount with the same configuration: the existing client already
      // matches what was asked for, so there is nothing to do and nothing
      // to strand.
      return
    }

    throw new Error(
      'configureEmbedSupabase() called with a different configuration after the Supabase client was already created',
    )
  }

  embedOverride = requested
}

/**
 * Configure the lazy Supabase singleton for an embedded mount whose host
 * holds the session (GwHostContext.session.mode === 'host'). The embed's
 * counterpart of configureEmbedSupabase(), with the same idempotency rule:
 * an identical repeat call is a no-op, a different one after the client
 * exists throws. The two are mutually exclusive.
 */
export function configureHostSession(options: HostSessionConfig): void {
  if (embedOverride) {
    throw new Error('configureHostSession() called after configureEmbedSupabase(); an embed uses one or the other')
  }

  if (supabaseClient) {
    const active = hostOverride
    const sameAsActive =
      active !== null &&
      active.baseUrl === options.baseUrl &&
      active.anonKey === options.anonKey &&
      active.meUrl === options.meUrl &&
      active.logoutUrl === options.logoutUrl

    if (sameAsActive) {
      // The hook is a fresh closure on every mount; keep the newest so it
      // points at the live mount's context, not the unmounted one.
      if (active.onSignedOut !== options.onSignedOut) {
        hostOverride = { ...active, onSignedOut: options.onSignedOut }
        // A new mount must not be born signed out because an earlier mount's
        // session ended: clear the shim's latch so it asks again.
        hostAuth?.resetSignedOut()
      }
      return
    }

    throw new Error(
      'configureHostSession() called with a different configuration after the Supabase client was already created',
    )
  }

  hostOverride = { ...options }
}

/** True when the client is (or will be) built in host-session mode. */
export function isHostSession(): boolean {
  return resolveAuthMode() === 'host-session'
}

/**
 * Admin gate status from the session holder. Only meaningful in
 * host-session mode; in local mode it always reports signed_out.
 */
export function getHostStatus(): Promise<HostStatus> {
  if (!isHostSession()) return Promise.resolve({ status: 'signed_out' })
  getSupabase()
  return hostAuth ? hostAuth.me() : Promise.resolve({ status: 'signed_out' })
}

export { signInUrl }
export type { HostStatus }

/**
 * The real Supabase project URL, for URLs that leave the admin: OAuth
 * redirect URIs (Slack, Google Sheets) and public storage URLs (see
 * wrapStoragePublicUrls). In host-session
 * mode VITE_SUPABASE_URL is the admin origin (so hand-rolled
 * `${VITE_SUPABASE_URL}/functions/v1/...` calls go through the session
 * holder), and VITE_SUPABASE_PUBLIC_URL carries the real one. It defaults to
 * VITE_SUPABASE_URL, so local mode is unchanged. Read at call time because an
 * embed sets the runtime config at mount, after this module is evaluated.
 */
export function getSupabasePublicUrl(): string {
  const configured = import.meta.env.VITE_SUPABASE_PUBLIC_URL
  if (configured) {
    if (isHttpsOrLocalhostUrl(configured)) return configured
    warnOnce(
      'public-url-scheme',
      `[supabase] Ignoring VITE_SUPABASE_PUBLIC_URL "${configured}": it must be an https URL (http only for localhost, 127.0.0.1 or *.localhost)`,
    )
  }
  return import.meta.env.VITE_SUPABASE_URL || ''
}

/** https, or http on localhost: the only schemes a URL handed to the outside may use. */
function isHttpsOrLocalhostUrl(value: string): boolean {
  try {
    const u = new URL(value)
    if (u.protocol === 'https:') return true
    // http only for local development: localhost, 127.0.0.1 and *.localhost
    // (e.g. supabase.gatewaze.localhost), which browsers resolve to loopback.
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.localhost'))
  } catch {
    return false
  }
}

const warned = new Set<string>()
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}

// Proxy export for backward compatibility — all `supabase.xxx()` calls work transparently.
// In host-session mode getSupabase() returns a client whose `auth` is the shim.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase()
    const value = (client as any)[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''

export { getSupabase }

export interface AdminUser {
  id: string
  email: string
  name: string
  role?: string
  is_active?: boolean
  created_at: string
  updated_at: string
}

export interface Account {
  id: string
  name: string
  slug: string
  description?: string
  logo_url?: string
  website?: string
  contact_email?: string
  contact_phone?: string
  is_active: boolean
  metadata?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface AccountUser {
  id: string
  account_id: string
  admin_profile_id: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AccountMemberDetail {
  account_user_id: string
  admin_profile_id: string
  user_email: string
  user_name: string
  user_role: string
  account_role: 'owner' | 'admin' | 'member' | 'viewer'
  is_active: boolean
  created_at: string
}
