'use client'

import { createBrowserClient } from '@supabase/ssr'
import { SupabaseClient } from '@supabase/supabase-js'
import { getClientBrandConfig } from '@/config/brand'

let supabaseClient: SupabaseClient | null = null

/**
 * Get or create a Supabase client for client-side use.
 * Uses @supabase/ssr's createBrowserClient which stores auth tokens
 * in cookies (instead of localStorage), making them available to
 * server components via createAuthenticatedServerSupabase().
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const config = getClientBrandConfig()
    supabaseClient = createBrowserClient(config.supabaseUrl, config.supabaseAnonKey)
  }
  return supabaseClient
}
