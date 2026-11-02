import { AuthError, type Session, type User } from '@supabase/supabase-js'

/**
 * Host-session mode: a same-origin session holder (the admin BFF standalone,
 * or the host application when embedded) keeps the real Supabase session in
 * an HttpOnly cookie. Page scripts only ever see this placeholder. Code that
 * builds `Authorization: Bearer ${access_token}` or `?access_token=` keeps
 * working, and the session holder swaps the placeholder for the real token.
 * The placeholder is not a secret.
 *
 * Expiry: only requests made through supabase-js (PostgREST, Storage,
 * functions.invoke) go through hostSessionFetch, so only they observe the
 * session holder's `x-gw-session: expired` marker. Hand-written fetch()
 * calls (the `${VITE_SUPABASE_URL}/functions/v1/...` and `/api/...` helpers)
 * are deliberately left alone: they just see a 401. The next supabase-js
 * call after expiry gets the same marker and signs the user out.
 *
 * Signed-out latch: SIGNED_OUT is emitted once and then latched. From then
 * on getSession() reports no session and further markers are ignored, until
 * the page navigates (a full load builds a new client). The client is a
 * module-level singleton, so an embed that unmounts and mounts again reuses
 * the latched client; configureHostSession() therefore clears the latch when
 * a new mount hands it a new hook, so that mount asks the session holder
 * again instead of starting signed out.
 */
export const HOST_SESSION_TOKEN = 'host-session'

/** Response header the session holder sets on a 401 when the cookie's session is gone. */
export const SESSION_EXPIRED_HEADER = 'x-gw-session'
export const SESSION_EXPIRED_VALUE = 'expired'

/**
 * The optional `admin` field of the session holder's /me 200: the user's
 * active admin_profiles row and the features admin_get_features grants them
 * (see AdminContext in @gatewaze/host-session). Lets the auth context and the
 * permission guards skip their own queries on first render.
 */
export interface HostAdminProfile {
  id: string
  user_id: string
  email: string
  name: string | null
  role: string
  avatar_url: string | null
  is_active: true
  created_at: string
  updated_at: string
}
export interface HostAdminContext {
  profile: HostAdminProfile
  features: string[]
}

/**
 * How long a /me admin context is used before falling back to the database.
 * Long enough to cover the first render's profile read and route guards, and
 * short enough that a permission changed mid-session is picked up on the next
 * navigation, as it was before /me carried it.
 */
export const ADMIN_CONTEXT_TTL_MS = 60_000

/** The admin context from a /me body, or undefined when absent or not the expected shape for this user. */
export function parseAdminContext(value: unknown, userId: string): HostAdminContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { profile, features } = value as { profile?: unknown; features?: unknown }
  if (!profile || typeof profile !== 'object') return undefined
  const p = profile as Record<string, unknown>
  const nullableString = (x: unknown) => x === null || typeof x === 'string'
  const profileOk =
    typeof p.id === 'string' &&
    p.id !== '' &&
    p.user_id === userId &&
    typeof p.email === 'string' &&
    nullableString(p.name) &&
    typeof p.role === 'string' &&
    nullableString(p.avatar_url) &&
    p.is_active === true &&
    typeof p.created_at === 'string' &&
    typeof p.updated_at === 'string'
  if (!profileOk) return undefined
  if (!Array.isArray(features) || !features.every((f) => typeof f === 'string')) return undefined
  return {
    profile: {
      id: p.id as string,
      user_id: userId,
      email: p.email as string,
      name: p.name as string | null,
      role: p.role as string,
      avatar_url: p.avatar_url as string | null,
      is_active: true,
      created_at: p.created_at as string,
      updated_at: p.updated_at as string,
    },
    features: [...features],
  }
}

export type HostStatus =
  | { status: 'ok'; user: User }
  | { status: 'signed_out' }
  | { status: 'not_admin'; email?: string }
  /** Signed in, and the session holder is still checking admin access; ask again after retryAfterMs. */
  | { status: 'pending'; retryAfterMs: number }
  /** The session holder could not answer (5xx, network, malformed reply). Not a sign-out. */
  | { status: 'unavailable' }

type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT'
type Listener = (event: AuthEvent, session: Session | null) => void | Promise<void>

/**
 * How long one /me request may take before it is abandoned and reported as
 * unavailable. Without it a hung session holder would leave the auth context
 * loading for ever (the embed blank).
 */
export const ME_TIMEOUT_MS = 8_000

export interface HostAuthOptions {
  /** Overrides ME_TIMEOUT_MS (tests). */
  meTimeoutMs?: number
  meUrl: string
  logoutUrl: string
  anonKey: string
  /**
   * Embedded only: the host owns sign-in, so a lost session (or a sign-in
   * request) is handed back to it rather than navigating this page. Read on
   * each use, because a re-mount replaces the hook while the client lives on.
   */
  getHostHook?: () => (() => void) | undefined
  embedded: boolean
}

const STANDALONE_LOGIN_PATH = '/bff/login'

/** Answers that keep a signed-in user out for now, but may later turn ok. */
const WITHHELD: ReadonlySet<HostStatus['status']> = new Set(['pending', 'unavailable', 'not_admin'])

/**
 * How long a not_admin answer from the session holder is reused. A session
 * holder whose admin check is still being retried answers 503
 * admin_check_pending, not 403, so a 403 should be final; keeping it short
 * anyway is defence in depth (an admin granted access mid-session, or a
 * session holder that answers 403 too early). ok and a 401 are definite and
 * kept for the page's life.
 */
export const NOT_ADMIN_CACHE_MS = 15_000

/** Retry-After bounds for a pending admin check, so a bad header cannot stall or spin the page. */
const DEFAULT_RETRY_AFTER_MS = 2_000
const MIN_RETRY_AFTER_MS = 500
const MAX_RETRY_AFTER_MS = 30_000

function retryAfterMs(header: string | null): number {
  const seconds = header === null ? NaN : Number(header)
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_AFTER_MS
  return Math.min(Math.max(seconds * 1000, MIN_RETRY_AFTER_MS), MAX_RETRY_AFTER_MS)
}

/**
 * Only a same-origin path may be sent as return_to. Anything else ('//evil',
 * '/\\evil', 'https://…', control characters) collapses to '/'. The BFF checks
 * this again; this keeps the browser from even asking for an open redirect.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/')) return '/'
  if (value.startsWith('//') || value.startsWith('/\\')) return '/'
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/'
  // Belt and braces: whatever the string checks above miss, the browser's own
  // URL parser must also resolve it to this origin.
  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return '/'
    return url.pathname + url.search + url.hash
  } catch {
    return '/'
  }
}

/** Where the standalone sign-in button sends the browser. */
export function signInUrl(returnTo: string = window.location.pathname + window.location.search): string {
  return `${STANDALONE_LOGIN_PATH}?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`
}

/** An OAuth redirectTo is an absolute URL; keep only its same-origin path. */
function returnToFromRedirect(redirectTo: string | undefined): string | undefined {
  if (!redirectTo) return undefined
  try {
    const url = new URL(redirectTo, window.location.origin)
    if (url.origin !== window.location.origin) return undefined
    return url.pathname + url.search + url.hash
  } catch {
    return undefined
  }
}

function syntheticSession(user: User): Session {
  // Far-future expiry: the session holder refreshes the real session, so
  // supabase-js callers never need to.
  const now = Math.floor(Date.now() / 1000)
  const expires_at = now + 365 * 24 * 3600
  return {
    access_token: HOST_SESSION_TOKEN,
    refresh_token: HOST_SESSION_TOKEN,
    token_type: 'bearer',
    expires_in: expires_at - now,
    expires_at,
    user,
  }
}

function unavailable(name: string): AuthError {
  return new AuthError(
    `supabase.auth.${name} is not available in host-session mode; the session holder owns sign-in and user management.`,
    400,
    'host_session_unsupported',
  )
}

function throwing(name: string) {
  return () => {
    throw new Error(
      `supabase.auth.${name} is not available in host-session mode; the session holder owns the Supabase session.`,
    )
  }
}

/**
 * Stand-in for `supabase.auth`. Covers the surface the admin and its modules
 * actually use (getSession, getUser, onAuthStateChange, signOut,
 * signInWithOAuth, signInWithOtp, admin.createUser/deleteUser) and fails
 * loudly for anything else.
 */
export function createHostAuth(options: HostAuthOptions) {
  const { meUrl, logoutUrl, anonKey, getHostHook, embedded, meTimeoutMs = ME_TIMEOUT_MS } = options
  const listeners = new Set<Listener>()
  let me: Promise<HostStatus> | null = null
  // When the cached `me` stops being valid; null means for the page's life.
  let meExpiresAt: number | null = null
  let signedOutEmitted = false
  // The admin context from the last /me 200, until ADMIN_CONTEXT_TTL_MS.
  let adminContext: { userId: string; value: HostAdminContext; expiresAt: number } | null = null

  // cache: true = keep for the page's life, false = ask again next time,
  // a number = keep for that many milliseconds.
  const fetchMe = async (): Promise<{ result: HostStatus; cache: boolean | number; admin?: HostAdminContext }> => {
    let res: Response
    try {
      res = await fetch(meUrl, {
        credentials: 'include',
        headers: { apikey: anonKey },
        signal: AbortSignal.timeout(meTimeoutMs),
      })
    } catch (err) {
      // Network failure or the timeout: says nothing about the session. Not cached.
      console.warn('[host-session] session check failed', err)
      return { result: { status: 'unavailable' }, cache: false }
    }
    if (res.ok) {
      // A 200 must carry { user }. Anything else is a session-holder bug, not
      // a sign-out, so it is logged and not cached.
      const body = (await res.json().catch(() => null)) as { user?: User; admin?: unknown } | null
      if (body?.user && typeof body.user === 'object' && typeof body.user.id === 'string') {
        // Optional: a session holder that does not send it just means the
        // admin reads it itself. One that sends it in the wrong shape is a
        // session-holder bug, logged so the lost shortcut is visible.
        const admin = parseAdminContext(body.admin, body.user.id)
        if (!admin && body.admin !== undefined) {
          console.warn(`[host-session] ${meUrl} sent an admin field in an unexpected shape; ignoring it`)
        }
        return { result: { status: 'ok', user: body.user }, cache: true, admin }
      }
      console.warn(`[host-session] ${meUrl} answered 200 without a user; treating as unavailable`)
      return { result: { status: 'unavailable' }, cache: false }
    }
    if (res.status === 403) {
      // The email is display-only; a 403 without a readable body is still a
      // definite "not an admin".
      const body = (await res.json().catch(() => null)) as { email?: unknown } | null
      const email = typeof body?.email === 'string' ? body.email : undefined
      return { result: { status: 'not_admin', email }, cache: NOT_ADMIN_CACHE_MS }
    }
    // 401 is the only definite "signed out", and is kept for the page's life.
    if (res.status === 401) return { result: { status: 'signed_out' }, cache: true }
    if (res.status === 503) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (body?.error === 'admin_check_pending') {
        return { result: { status: 'pending', retryAfterMs: retryAfterMs(res.headers.get('retry-after')) }, cache: false }
      }
    }
    // Anything else (session_unavailable, other 5xx, an unexpected 4xx) is
    // the session holder failing to answer, not a sign-out. Not cached.
    return { result: { status: 'unavailable' }, cache: false }
  }

  // The last answer the session holder gave, to spot access arriving.
  let lastStatus: HostStatus['status'] | null = null

  const loadMe = (): Promise<HostStatus> => {
    if (me && meExpiresAt !== null && Date.now() >= meExpiresAt) {
      me = null
      meExpiresAt = null
    }
    if (!me) {
      const pending = fetchMe().then(({ result, cache, admin }) => {
        // `me === pending` guards against a sign-out (or reset) that replaced
        // the cache while this request was in flight.
        if (me === pending) {
          // Only the latest answer, and only one no sign-out has replaced,
          // may set the admin context.
          adminContext =
            result.status === 'ok' && admin
              ? { userId: result.user.id, value: admin, expiresAt: Date.now() + ADMIN_CONTEXT_TTL_MS }
              : null
          if (cache === false) me = null
          else if (typeof cache === 'number') meExpiresAt = Date.now() + cache
          // Access arrived after an answer that withheld it (a pending
          // admin check, an unavailable session holder, a not_admin that was
          // re-checked): tell listeners, as supabase-js does on sign-in, so
          // the auth context's listener picks the user up without a reload.
          // (The embed's access gate does not rely on this: it resolves the
          // user itself through recheckAccess, which also covers a profile
          // lookup the listener would drop.) Inside the `me === pending`
          // guard, so an ok that lands after a sign-out is not announced.
          if (result.status === 'ok' && lastStatus !== null && WITHHELD.has(lastStatus)) {
            emit('SIGNED_IN', syntheticSession(result.user))
          }
          lastStatus = result.status
        }
        return result
      })
      me = pending
    }
    return me
  }

  // One listener failing (synchronously or by rejecting) must not stop the
  // others or surface as an unhandled rejection.
  const deliver = (listener: Listener, event: AuthEvent, session: Session | null) => {
    try {
      void Promise.resolve(listener(event, session)).catch((err) =>
        console.error('[host-session] auth listener failed', err),
      )
    } catch (err) {
      console.error('[host-session] auth listener failed', err)
    }
  }

  const emit = (event: AuthEvent, session: Session | null) => {
    for (const listener of listeners) deliver(listener, event, session)
  }

  /** The session holder said the session is gone (or the user signed out). Latches; see the file header. */
  // notifyHost: false when this page signs out but the session holder may not
  // have (a failed logout POST), so the host hook, which navigates away, must
  // not run and drop the error the caller is about to show.
  const signedOut = ({ notifyHost = true }: { notifyHost?: boolean } = {}) => {
    me = Promise.resolve({ status: 'signed_out' })
    meExpiresAt = null
    adminContext = null
    if (signedOutEmitted) return
    signedOutEmitted = true
    emit('SIGNED_OUT', null)
    const onSignedOut = notifyHost ? getHostHook?.() : undefined
    if (onSignedOut) {
      try {
        onSignedOut()
      } catch (err) {
        console.error('[host-session] onSignedOut hook failed', err)
      }
    }
  }

  const sessionOrNull = async (): Promise<Session | null> => {
    const status = await loadMe()
    return status.status === 'ok' ? syntheticSession(status.user) : null
  }

  let subscriptionCount = 0

  const auth = {
    getSession: async () => ({ data: { session: await sessionOrNull() }, error: null }),

    getUser: async () => {
      const session = await sessionOrNull()
      return { data: { user: session?.user ?? null }, error: null }
    },

    onAuthStateChange: (callback: Listener) => {
      listeners.add(callback)
      void sessionOrNull().then((session) => {
        if (listeners.has(callback)) deliver(callback, 'INITIAL_SESSION', session)
      })
      return {
        data: {
          subscription: {
            id: `host-session-${++subscriptionCount}`,
            callback,
            unsubscribe: () => {
              listeners.delete(callback)
            },
          },
        },
      }
    },

    signOut: async () => {
      let error: AuthError | null = null
      try {
        const res = await fetch(logoutUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { apikey: anonKey },
        })
        if (!res.ok) error = new AuthError(`Sign-out failed (${res.status})`, res.status)
      } catch (err) {
        error = new AuthError(err instanceof Error ? err.message : 'Sign-out failed')
      }
      // This page is signed out either way. If the POST failed, the session
      // holder's session is still live: reloading the page signs the user
      // back in. The caller gets the error and must say so, not report success.
      signedOut({ notifyHost: error === null })
      return { error }
    },

    signInWithOAuth: async (credentials?: { provider?: string; options?: { redirectTo?: string } }) => {
      const provider = credentials?.provider ?? null
      if (embedded) {
        // The host owns sign-in when embedded.
        const onSignedOut = getHostHook?.()
        if (onSignedOut) {
          try {
            onSignedOut()
          } catch (err) {
            console.error('[host-session] onSignedOut hook failed', err)
            return { data: { provider, url: null }, error: new AuthError('The host could not start sign-in') }
          }
          return { data: { provider, url: null }, error: null }
        }
        return { data: { provider, url: null }, error: unavailable('signInWithOAuth') }
      }
      const url = signInUrl(returnToFromRedirect(credentials?.options?.redirectTo))
      window.location.assign(url)
      return { data: { provider, url }, error: null }
    },

    // Callers already handle `error` here (sendMagicLink, createAdminAccount),
    // so these return one rather than throwing.
    signInWithOtp: async () => ({ data: { user: null, session: null }, error: unavailable('signInWithOtp') }),

    admin: new Proxy(
      {
        createUser: async () => ({ data: { user: null, session: null }, error: unavailable('admin.createUser') }),
        deleteUser: async () => ({ data: { user: null, session: null }, error: unavailable('admin.deleteUser') }),
      } as Record<string, unknown>, // index signature, so the trap can look up any admin method name
      {
        get(target, prop) {
          if (typeof prop === 'symbol' || prop === 'then') return undefined
          return prop in target ? target[prop] : throwing(`admin.${prop}`)
        },
      },
    ),

    startAutoRefresh: async () => undefined,
    stopAutoRefresh: async () => undefined,

    /** Admin gate status from the session holder. Not part of supabase-js. */
    me: loadMe,
    /**
     * The admin context the last /me 200 carried for this auth user, while
     * it is fresh; null otherwise. Not part of supabase-js.
     */
    adminContext: (userId: string): HostAdminContext | null => {
      if (!adminContext || adminContext.userId !== userId || Date.now() >= adminContext.expiresAt) return null
      return adminContext.value
    },
    /** As adminContext, looked up by admin profile id (the auth context's user id). */
    adminContextForProfile: (profileId: string): HostAdminContext | null => {
      if (!adminContext || adminContext.value.profile.id !== profileId || Date.now() >= adminContext.expiresAt) return null
      return adminContext.value
    },
    /** Called by the client's fetch when a response carries the expiry marker. */
    signedOut,
    /** Clears the signed-out latch so the next call asks the session holder again (embed re-mount). */
    resetSignedOut: () => {
      signedOutEmitted = false
      me = null
      meExpiresAt = null
      lastStatus = null
      adminContext = null
    },
  }

  // The cast widens the known surface to an index signature so the trap can
  // look up any property name; unknown names get the thrower, never undefined.
  return new Proxy(auth as typeof auth & Record<string, unknown>, {
    get(target, prop) {
      // Symbols and `then` must stay undefined, or inspecting or awaiting the
      // object would call the thrower.
      if (typeof prop === 'symbol' || prop === 'then') return undefined
      return prop in target ? target[prop] : throwing(prop)
    },
  })
}

export type HostAuth = ReturnType<typeof createHostAuth>

/**
 * Wraps the client's fetch: always send the cookie, and treat only the
 * session holder's explicit expiry marker as "signed out". A plain 401 (an
 * RLS-denied call, an edge function's own auth error) is left to the caller.
 */
export function hostSessionFetch(onExpired: () => void): typeof fetch {
  return async (input, init) => {
    const res = await fetch(input, { ...init, credentials: 'include' })
    if (res.status === 401 && res.headers.get(SESSION_EXPIRED_HEADER) === SESSION_EXPIRED_VALUE) {
      onExpired()
    }
    return res
  }
}
