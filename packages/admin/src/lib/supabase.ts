import { createClient, SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient

  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
  }

  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: 'gatewaze-admin-auth-token',
    },
  })

  return supabaseClient
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
