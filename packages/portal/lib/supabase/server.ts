import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getBrandConfigById } from '@/config/brand'

/**
 * Create a Supabase client for server-side use (anon key, no user session).
 * Each call creates a new client instance (stateless).
 */
export async function createServerSupabase(brandId: string): Promise<SupabaseClient> {
  const config = await getBrandConfigById(brandId)
  const url = process.env.SUPABASE_URL || config.supabaseUrl
  return createClient(url, config.supabaseAnonKey)
}

/**
 * Create a Supabase client that carries the current user's session from cookies.
 * Uses @supabase/ssr to read auth tokens from Next.js request cookies.
 * Falls back to anon access if no session is present.
 */
export async function createAuthenticatedServerSupabase(brandId: string): Promise<SupabaseClient> {
  const config = await getBrandConfigById(brandId)
  const url = process.env.SUPABASE_URL || config.supabaseUrl
  const cookieStore = await cookies()

  return createServerClient(url, config.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // setAll can fail in Server Components (read-only).
          // This is fine — the session is read-only in this context.
        }
      },
    },
  })
}
