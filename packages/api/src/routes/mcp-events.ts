/**
 * MCP request-log ingest (spec-mcp-lfid-access.md §5).
 *
 * The MCP pod batches its per-request JSONL events and POSTs them here;
 * rows land in mcp_request_log for the admin Activity tab. Authenticated
 * with the shared MCP_EVENTS_TOKEN (same static-internal-token pattern as
 * the scrapling-fetcher service).
 */
import { Router } from 'express';
import { labeledRouter } from '../lib/router-registry.js';
import { getSupabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

export const mcpEventsRouter: Router = labeledRouter('jwt');

const OUTCOMES = new Set(['ok', 'error', 'unknown_tool', 'insufficient_scope']);
const IDENTITY_KINDS = new Set(['anonymous', 'oauth', 'api_key']);
const MAX_BATCH = 500;

mcpEventsRouter.post('/', async (req, res) => {
  try {
    const expected = process.env.MCP_EVENTS_TOKEN;
    if (!expected || req.headers['x-internal-token'] !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const events = (req.body?.events ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events array required' });
    }
    const rows = events.slice(0, MAX_BATCH).flatMap((e) => {
      if (typeof e.tool !== 'string' || !OUTCOMES.has(String(e.outcome))) return [];
      return [{
        ts: typeof e.ts === 'string' ? e.ts : new Date().toISOString(),
        identity_kind: IDENTITY_KINDS.has(String(e.identity_kind)) ? e.identity_kind : 'anonymous',
        subject: e.subject ?? null,
        email: e.email ?? null,
        person_id: e.person_id ?? null,
        tier: e.tier ?? null,
        ip: e.ip ?? null,
        client_name: e.client_name ?? null,
        era: e.era ?? null,
        tool: e.tool,
        args: e.args ?? null,
        outcome: e.outcome,
        error: e.error ?? null,
        ms: Number.isFinite(e.ms as number) ? e.ms : null,
        bytes: Number.isFinite(e.bytes as number) ? e.bytes : null,
        rows: Number.isFinite(e.rows as number) ? e.rows : null,
      }];
    });
    if (rows.length === 0) return res.status(400).json({ error: 'no valid events' });

    const { error } = await getSupabase().from('mcp_request_log').insert(rows);
    if (error) throw new Error(error.message);
    res.json({ inserted: rows.length });
  } catch (err) {
    logger.error({ err }, '[mcp-events] ingest failed');
    res.status(500).json({ error: 'ingest failed' });
  }
});
