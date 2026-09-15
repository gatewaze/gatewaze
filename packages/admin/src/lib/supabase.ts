import { createClient, SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null
// Set only by configureEmbedSupabase(), before getSupabase() ever runs.
// Lets an embedded mount use its own Supabase project config and a
// distinct localStorage key so its session never collides with (or gets
// read/cleared by) a host page or a standalone admin session sharing the
// same origin.
let embedOverride: { url: string; anonKey: string; storageKey: string } | null = null

function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient

  const url = embedOverride?.url ?? import.meta.env.VITE_SUPABASE_URL
  const anonKey = embedOverride?.anonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  const storageKey = embedOverride?.storageKey ?? 'gatewaze-admin-auth-token'

  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
  }

  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey,
    },
  })

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
 * be loaded" — reported from the LFX pilot, and reproducible every time.
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

// Proxy export for backward compatibility — all `supabase.xxx()` calls work transparently
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
