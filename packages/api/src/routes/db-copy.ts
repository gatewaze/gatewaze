import { Router } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase.js';

export const dbCopyRouter = Router();

/**
 * Tables to copy, ordered so that parent tables come before children
 * (respecting foreign key constraints). Junction/child tables reference
 * their parents, so parents must be inserted first.
 */
const COPY_TABLES = [
  // Independent / root tables
  'app_settings',
  'categories',
  'topics',
  'speakers',
  'sponsors',
  'calendars',
  'customers',
  'email_templates',

  // Tables that depend on root tables
  'events',
  'accounts',

  // Junction tables and children of events
  'event_speakers',
  'event_categories',
  'event_topics',
  'calendar_events',
  'account_users',
  'event_registrations',
  'event_agenda_tracks',
  'event_media',
  'event_sponsors',
  'discount_codes',
  'event_budget_items',
  'event_communication_settings',

  // Tables that depend on the above
  'event_agenda_entries',
  'event_attendance',
  'event_interest',
  'event_talks',
  'email_logs',
  'email_batch_jobs',
  'ad_tracking_sessions',
  'event_competitions',

  // Deep children
  'event_agenda_entry_speakers',
  'event_attendee_matches',
  'conversion_events_log',
  'competition_entries',

  // Deepest children
  'competition_winners',

  // Scrapers (independent)
  'scrapers',
] as const;

/**
 * Maps tables to the column name used for the "delete all" filter.
 * Most tables use 'id', but junction tables and special tables differ.
 */
const DELETE_KEY_MAP: Record<string, string> = {
  app_settings: 'key',
  event_speakers: 'event_id',
  event_categories: 'event_id',
  event_topics: 'event_id',
  calendar_events: 'event_id',
  event_agenda_entry_speakers: 'agenda_entry_id',
  account_users: 'account_id',
};

interface CopyProgress {
  type: 'start' | 'table_start' | 'table_done' | 'table_error' | 'done' | 'error';
  table?: string;
  count?: number;
  total?: number;
  current?: number;
  message?: string;
}

function sendSSE(res: any, data: CopyProgress) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Fetch all rows from a table in the source Supabase, paginating with
 * range headers so we don't hit the default 1000-row limit.
 */
async function fetchAllRows(source: SupabaseClient, table: string): Promise<any[]> {
  const PAGE_SIZE = 1000;
  const allRows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await source
      .from(table)
      .select('*')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

/**
 * POST /api/db-copy/start
 *
 * Body: { sourceUrl, sourceServiceRoleKey, tables?: string[] }
 *
 * Streams progress via SSE. The client should read the response as an
 * EventSource-compatible stream.
 */
dbCopyRouter.post('/start', async (req, res) => {
  const { sourceUrl, sourceServiceRoleKey, tables } = req.body;

  if (!sourceUrl || !sourceServiceRoleKey) {
    return res.status(400).json({ error: 'sourceUrl and sourceServiceRoleKey are required' });
  }

  // Validate the URL looks like a Supabase URL
  try {
    new URL(sourceUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid sourceUrl' });
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const selectedTables = tables && tables.length > 0
    ? COPY_TABLES.filter((t) => tables.includes(t))
    : [...COPY_TABLES];

  sendSSE(res, { type: 'start', total: selectedTables.length, message: `Copying ${selectedTables.length} tables` });

  // Create source client with service role key (bypasses RLS)
  const source = createClient(sourceUrl, sourceServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Local DB client (also service role)
  const local = getSupabase();

  let completed = 0;

  for (const table of selectedTables) {
    sendSSE(res, { type: 'table_start', table, current: completed + 1, total: selectedTables.length });

    try {
      // 1. Fetch all rows from source
      const rows = await fetchAllRows(source, table);

      if (rows.length === 0) {
        sendSSE(res, { type: 'table_done', table, count: 0, current: completed + 1, total: selectedTables.length, message: 'No rows to copy' });
        completed++;
        continue;
      }

      // 2. Delete existing data in local table.
      //    Supabase requires a filter on delete, so we use a never-matching
      //    condition with .neq() on the table's primary key column.
      const deleteColumn = DELETE_KEY_MAP[table] ?? 'id';
      const nilValue = deleteColumn === 'key' ? ''
        : table === 'scrapers' ? -1
        : '00000000-0000-0000-0000-000000000000';
      await local.from(table).delete().neq(deleteColumn, nilValue as any);

      // 3. Insert rows in batches
      const BATCH_SIZE = 500;
      let inserted = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        // Strip generated columns that Postgres won't allow us to insert
        const cleanBatch = batch.map((row) => {
          const clean = { ...row };
          // customers.full_name is a GENERATED ALWAYS column
          if (table === 'customers') {
            delete clean.full_name;
          }
          return clean;
        });

        const { error } = await local.from(table).insert(cleanBatch);

        if (error) {
          throw new Error(`Batch insert failed at row ${i}: ${error.message}`);
        }

        inserted += batch.length;
      }

      sendSSE(res, { type: 'table_done', table, count: inserted, current: completed + 1, total: selectedTables.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      sendSSE(res, { type: 'table_error', table, current: completed + 1, total: selectedTables.length, message });
    }

    completed++;
  }

  sendSSE(res, { type: 'done', message: `Completed copying ${completed} tables` });
  res.end();
});

/**
 * POST /api/db-copy/test-connection
 *
 * Body: { sourceUrl, sourceServiceRoleKey }
 *
 * Tests the connection to the source Supabase by querying app_settings.
 */
dbCopyRouter.post('/test-connection', async (req, res) => {
  const { sourceUrl, sourceServiceRoleKey } = req.body;

  if (!sourceUrl || !sourceServiceRoleKey) {
    return res.status(400).json({ error: 'sourceUrl and sourceServiceRoleKey are required' });
  }

  try {
    new URL(sourceUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid sourceUrl' });
  }

  try {
    const source = createClient(sourceUrl, sourceServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Try to read from a table that should always exist
    const { data, error } = await source.from('platform_settings').select('key').limit(1);

    if (error) {
      return res.status(400).json({ error: `Connection failed: ${error.message}` });
    }

    // Also get table row counts for the UI
    const tableCounts: Record<string, number> = {};
    for (const table of COPY_TABLES) {
      const { count, error: countError } = await source
        .from(table)
        .select('*', { count: 'exact', head: true });

      tableCounts[table] = countError ? -1 : (count ?? 0);
    }

    res.json({ success: true, tableCounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/db-copy/tables
 *
 * Returns the list of copyable tables.
 */
dbCopyRouter.get('/tables', (_req, res) => {
  res.json({ tables: [...COPY_TABLES] });
});
