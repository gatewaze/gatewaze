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
 * entry point calls this first, ahead of any provider mount). Throws if
 * a client already exists — the embed's mount() only ever calls this
 * once per page per the "one live mount" contract; a second call would
 * silently strand callers on the first mount's project/storage key.
 */
export function configureEmbedSupabase(options: {
  url: string
  anonKey: string
  storageKeySuffix?: string
}): void {
  if (supabaseClient) {
    throw new Error('configureEmbedSupabase() called after the Supabase client was already created')
  }
  embedOverride = {
    url: options.url,
    anonKey: options.anonKey,
    storageKey: `gatewaze-admin-auth-token-${options.storageKeySuffix || 'lfx_embed'}`,
  }
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
