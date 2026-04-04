/**
 * Hook to fetch and manage configurable content categories from platform_settings.
 *
 * Content categories are stored as a JSON array under the key `content_categories`.
 * Each entry has { value, label }. The array order defines display priority
 * (index 0 = highest priority).
 *
 * Falls back to an empty array if nothing is configured (categories are optional).
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface ContentCategoryOption {
  value: string;
  label: string;
}

export const MAX_CONTENT_CATEGORIES = 10;

export function useContentCategories() {
  const [contentCategories, setContentCategories] = useState<ContentCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'content_categories')
        .maybeSingle();

      if (!error && data?.value) {
        const parsed = JSON.parse(data.value);
        if (Array.isArray(parsed)) {
          setContentCategories(parsed.slice(0, MAX_CONTENT_CATEGORIES));
        }
      }
    } catch {
      // no categories configured
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { contentCategories, loading, reload: load };
}

/** Save content categories to platform_settings */
export async function saveContentCategories(categories: ContentCategoryOption[]): Promise<{ error?: string }> {
  const trimmed = categories
    .filter((c) => c.value.trim() && c.label.trim())
    .slice(0, MAX_CONTENT_CATEGORIES);

  const { error } = await supabase
    .from('platform_settings')
    .upsert(
      { key: 'content_categories', value: JSON.stringify(trimmed) },
      { onConflict: 'key' }
    );

  if (error) return { error: error.message };
  return {};
}

/** Convert a label to a URL-safe value (slug) */
export function categoryLabelToValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
