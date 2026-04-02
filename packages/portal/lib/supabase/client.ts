'use client'

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getClientBrandConfig } from '@/config/brand'

let supabaseClient: SupabaseClient | null = null

/**
 * Get or create a Supabase client for client-side use
 * Singleton pattern - creates client once and reuses
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const config = getClientBrandConfig()
    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey)
  }
  return supabaseClient
}
