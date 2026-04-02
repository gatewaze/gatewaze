/**
 * Hook to fetch and manage people attribute configuration from platform_settings.
 *
 * Stored as JSON under the key `people_attributes`.
 * Each entry has { key, label, enabled, required }.
 *
 * Falls back to DEFAULT_PEOPLE_ATTRIBUTES if nothing is configured.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type PeopleAttributeConfig,
  DEFAULT_PEOPLE_ATTRIBUTES,
} from '@gatewaze/shared/types/people';

export { DEFAULT_PEOPLE_ATTRIBUTES };
export type { PeopleAttributeConfig };

export function usePeopleAttributes() {
  const [attributes, setAttributes] = useState<PeopleAttributeConfig[]>(DEFAULT_PEOPLE_ATTRIBUTES);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'people_attributes')
        .maybeSingle();

      if (!error && data?.value) {
        const parsed = JSON.parse(data.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAttributes(parsed);
        }
      }
    } catch {
      // use defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { attributes, loading, reload: load };
}

/** Save people attributes config to platform_settings */
export async function savePeopleAttributes(
  attrs: PeopleAttributeConfig[]
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('platform_settings')
    .upsert(
      { key: 'people_attributes', value: JSON.stringify(attrs) },
      { onConflict: 'key' }
    );

  if (error) return { error: error.message };
  return {};
}
