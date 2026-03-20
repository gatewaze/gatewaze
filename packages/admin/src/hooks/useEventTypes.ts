/**
 * Hook to fetch and manage configurable event types from platform_settings.
 *
 * Event types are stored as a JSON array under the key `event_types`.
 * Each entry has { value, label }. Maximum 6 event types allowed.
 *
 * Falls back to DEFAULT_EVENT_TYPES if nothing is configured.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface EventTypeOption {
  value: string;
  label: string;
}

export const MAX_EVENT_TYPES = 6;

export const DEFAULT_EVENT_TYPES: EventTypeOption[] = [
  { value: 'conference', label: 'Conference' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'meetup', label: 'Meetup' },
  { value: 'webinar', label: 'Webinar' },
  { value: 'hackathon', label: 'Hackathon' },
];

export function useEventTypes() {
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>(DEFAULT_EVENT_TYPES);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'event_types')
        .maybeSingle();

      if (!error && data?.value) {
        const parsed = JSON.parse(data.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setEventTypes(parsed.slice(0, MAX_EVENT_TYPES));
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

  return { eventTypes, loading, reload: load };
}

/** Save event types to platform_settings */
export async function saveEventTypes(types: EventTypeOption[]): Promise<{ error?: string }> {
  const trimmed = types
    .filter((t) => t.value.trim() && t.label.trim())
    .slice(0, MAX_EVENT_TYPES);

  const { error } = await supabase
    .from('platform_settings')
    .upsert(
      { key: 'event_types', value: JSON.stringify(trimmed) },
      { onConflict: 'key' }
    );

  if (error) return { error: error.message };
  return {};
}

/** Convert a label to a URL-safe value (slug) */
export function labelToValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
