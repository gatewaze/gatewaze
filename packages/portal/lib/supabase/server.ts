import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getBrandConfigById } from '@/config/brand'

/**
 * Create a Supabase client for server-side use
 * Each call creates a new client instance (stateless)
 */
export async function createServerSupabase(brandId: string): Promise<SupabaseClient> {
  const config = await getBrandConfigById(brandId)
  // Use internal Docker network URL for server-side fetches (falls back to brand URL)
  const url = process.env.SUPABASE_URL || config.supabaseUrl
  return createClient(url, config.supabaseAnonKey)
}
