import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables');
  }

  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'gatewaze-auth-token',
    },
  });

  return supabaseClient;
}

export function clearSupabaseClient(): void {
  supabaseClient = null;
}

// Lazy proxy so files ported from gatewaze-admin can `import { supabase }` unchanged
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabase();
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// Re-export the URL for components that need it
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

// Re-exported types used by utility services
export interface Account {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
  website?: string;
  contact_email?: string;
  contact_phone?: string;
  is_active: boolean;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AccountUser {
  id: string;
  account_id: string;
  admin_profile_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountMemberDetail {
  account_user_id: string;
  admin_profile_id: string;
  user_email: string;
  user_name: string;
  user_role: string;
  account_role: 'owner' | 'admin' | 'member' | 'viewer';
  is_active: boolean;
  created_at: string;
}
