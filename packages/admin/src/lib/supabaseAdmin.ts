/**
 * Multi-brand Supabase client for Gatewaze Admin
 * This module provides brand-aware Supabase client initialization
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getBrandConfig, getSupabaseConfig, isSupabaseConfigured, getAuthConfig } from '@/config/brands';

// Cache for Supabase clients per brand
const supabaseClients: Map<string, SupabaseClient | null> = new Map();

/**
 * Get or create a Supabase client for the current brand
 * @returns Supabase client instance or null if not configured
 */
export function getBrandSupabase(): SupabaseClient | null {
  const brandConfig = getBrandConfig();
  const brandId = brandConfig.id;

  // Check if we already have a client for this brand
  if (supabaseClients.has(brandId)) {
    return supabaseClients.get(brandId) || null;
  }

  // Check if Supabase is configured for this brand
  if (!isSupabaseConfigured()) {
    console.warn(`Supabase not configured for brand: ${brandId}`);
    supabaseClients.set(brandId, null);
    return null;
  }

  const { url, anonKey } = getSupabaseConfig();
  const { storageKey } = getAuthConfig();

  // Create the Supabase client with brand-specific auth storage
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      storageKey: storageKey,
      storage: {
        getItem: (key: string) => {
          try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
          } catch (error) {
            console.error('Error getting auth from localStorage:', error);
            return null;
          }
        },
        setItem: (key: string, value: string) => {
          try {
            localStorage.setItem(key, JSON.stringify(value));
          } catch (error) {
            console.error('Error setting auth in localStorage:', error);
          }
        },
        removeItem: (key: string) => {
          try {
            localStorage.removeItem(key);
          } catch (error) {
            console.error('Error removing auth from localStorage:', error);
          }
        },
      },
    },
  });

  // Cache the client
  supabaseClients.set(brandId, client);

  return client;
}

/**
 * Clear the cached Supabase client for the current brand
 * Useful when switching brands or updating credentials
 */
export function clearBrandSupabaseCache(): void {
  const brandConfig = getBrandConfig();
  supabaseClients.delete(brandConfig.id);
}

/**
 * Clear all cached Supabase clients
 */
export function clearAllSupabaseCache(): void {
  supabaseClients.clear();
}

/**
 * Get the Supabase client for a specific brand
 * @param brandId The brand ID to get the client for
 * @returns Supabase client instance or null if not configured
 */
export function getSupabaseForBrand(brandId: string): SupabaseClient | null {
  // Check if we already have a client for this brand
  if (supabaseClients.has(brandId)) {
    return supabaseClients.get(brandId) || null;
  }

  // We need to create a client for this specific brand
  // This would require loading that brand's config
  // For now, we'll return null if it's not the current brand
  const currentBrand = getBrandConfig();
  if (currentBrand.id === brandId) {
    return getBrandSupabase();
  }

  console.warn(`Cannot create Supabase client for non-current brand: ${brandId}`);
  return null;
}

// Re-export the main client getter for backward compatibility
export const supabase = getBrandSupabase;

// Export type for use in other files
export type { SupabaseClient };