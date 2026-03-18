/**
 * Fetch a single value from the app_settings table.
 * Used for large content (legal pages HTML) that shouldn't be loaded into BrandConfig.
 */
import { createClient } from '@supabase/supabase-js'

export async function getAppSetting(key: string): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) return null

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
    })

    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()

    if (error || !data) return null
    return data.value || null
  } catch {
    return null
  }
}
