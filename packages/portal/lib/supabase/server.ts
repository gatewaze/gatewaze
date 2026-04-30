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
  // Use public URL so cookie storage key matches the browser's cookies
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || config.supabaseUrl
  // Use internal URL for actual API requests (container-to-container in Docker)
  const internalUrl = process.env.SUPABASE_URL || publicUrl
  const cookieStore = await cookies()

  // Create the SSR client with the PUBLIC URL so it finds the right cookies
  const client = createServerClient(publicUrl, config.supabaseAnonKey, {
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
          // cookieStore.set throws on Server Components (which are
          // read-only contexts). The auth flow tolerates that — the
          // session refresh just won't persist there.
        }
      },
    },
    // Override the REST/auth URLs to use the internal network URL
    // so server-side requests don't go through Traefik
    ...(internalUrl !== publicUrl ? {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          const rewritten = url.replace(publicUrl, internalUrl)
          return fetch(rewritten, init)
        },
      },
    } : {}),
  })

  return client
}
