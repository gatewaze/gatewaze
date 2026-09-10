/**
 * The Supabase auth client (auth only — data flows through the Express
 * API; the app never talks to Postgres directly and never holds a service
 * key). Plain supabase-js, not @supabase/ssr: that is the portal's cookie
 * world.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { largeSecureStore } from './largeSecureStore';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: largeSecureStore,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
