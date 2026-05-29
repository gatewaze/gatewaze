import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SYNC_STATUSES = ['pending', 'syncing', 'synced', 'failed'] as const;
export type LumaSyncStatus = (typeof SYNC_STATUSES)[number];
export function isLumaSyncStatus(s: string): s is LumaSyncStatus {
  return (SYNC_STATUSES as readonly string[]).includes(s);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EventRow {
  id: string;
  luma_event_id: string | null;
  luma_synced_at: string | null;
  updated_at: string | null;
  [key: string]: unknown;
}

/**
 * Service-role access to events for the Luma sync. Uses SUPABASE_SERVICE_ROLE_KEY
 * (RLS-bypassing) — acceptable for a scoped internal service that only reads the
 * sync candidate set and writes the luma_sync_* columns. NOT a general events API.
 */
export class EventsStore {
  private sb: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  /** Events on calendars with luma_sync_enabled=true that have a luma_event_id
   *  and changed since their last push. The ownership gate. */
  async lumaSyncable(): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.sb
      .from('calendars')
      .select(
        'luma_calendar_id, calendars_events(events(id, event_id, event_title, event_description, event_start, event_end, event_timezone, event_location, venue_address, event_featured_image, luma_event_id, luma_sync_status, luma_synced_at, updated_at))',
      )
      .eq('luma_sync_enabled', true);
    if (error) throw new Error(`luma_syncable_failed: ${error.message}`);

    const out: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    // Supabase infers the embedded `events` relation as a to-many array; the
    // junction is to-one, so cast through unknown to our actual shape.
    const rows = (data ?? []) as unknown as Array<{
      luma_calendar_id: string | null;
      calendars_events: Array<{ events: EventRow | null }> | null;
    }>;
    for (const cal of rows) {
      for (const link of cal.calendars_events ?? []) {
        const ev = link.events;
        if (!ev || !ev.luma_event_id) continue;
        const needsSync =
          !ev.luma_synced_at || (ev.updated_at != null && new Date(ev.updated_at) > new Date(ev.luma_synced_at));
        if (!needsSync || seen.has(ev.id)) continue;
        seen.add(ev.id);
        out.push({ ...ev, luma_calendar_id: cal.luma_calendar_id });
      }
    }
    return out;
  }

  async get(id: string): Promise<Record<string, unknown> | null> {
    const col = UUID_RE.test(id) ? 'id' : 'event_id';
    const { data, error } = await this.sb.from('events').select('*').eq(col, id).maybeSingle();
    if (error) throw new Error(`events_get_failed: ${error.message}`);
    return data as Record<string, unknown> | null;
  }

  /** Writes ONLY the luma_sync_* columns. */
  async setLumaSync(
    id: string,
    status: LumaSyncStatus,
    pushedHash?: string,
    errorMsg?: string,
  ): Promise<Record<string, unknown>> {
    const patch: Record<string, unknown> = { luma_sync_status: status };
    if (status === 'synced') patch.luma_synced_at = new Date().toISOString();
    if (pushedHash !== undefined) patch.luma_pushed_hash = pushedHash;
    patch.luma_sync_error = status === 'failed' ? (errorMsg ?? '') : null;

    const { data, error } = await this.sb
      .from('events')
      .update(patch)
      .eq('id', id)
      .select('id, luma_sync_status, luma_synced_at')
      .single();
    if (error) throw new Error(`events_set_luma_sync_failed: ${error.message}`);
    return data as Record<string, unknown>;
  }
}
