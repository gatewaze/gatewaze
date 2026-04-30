/**
 * Redirects API Routes
 *
 * Provides endpoints to sync and manage Short.io shortened URLs.
 */

import { type Request, type Response } from 'express';
// SERVICE-ROLE OK: admin sync to Short.io; the redirects table is
// platform-wide (no account_id), populated by an admin-driven sync
// from an external API. Service-role is appropriate.
import { getSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';
import { logger } from '../lib/logger.js';

const SHORTIO_API_BASE = 'https://api.short.io';
const RATE_LIMIT_DELAY_MS = 200;
const RATE_LIMIT_RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 5;

export const redirectsRouter = labeledRouter('jwt');
redirectsRouter.use(requireJwt());

function getApiKey(): string | null {
  return process.env.SHORTIO_API_KEY || null;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<globalThis.Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, options);
    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
      if (attempt < retries) {
        const waitTime = RATE_LIMIT_RETRY_DELAY_MS * attempt;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
    }
    return response;
  }
  throw new Error('Max retries exceeded');
}

// Sync redirects from Short.io
redirectsRouter.post('/sync', async (req: Request, res: Response) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(503).json({ error: 'Short.io not configured (SHORTIO_API_KEY not set)' });
  }

  const { domain } = req.body;
  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }

  const supabase = getSupabase();

  // Create sync log
  const { data: syncLog, error: syncLogError } = await supabase
    .from('redirects_sync_logs')
    .insert({
      domain,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (syncLogError) {
    return res.status(500).json({ error: 'Failed to create sync log' });
  }

  // Start sync in background
  syncShortIoLinks(supabase, apiKey, domain, syncLog.id).catch((err) => logger.error({ err }, "redirect sync background failure"));

  res.json({ success: true, message: 'Sync started', syncLogId: syncLog.id });
});

// Get sync status
redirectsRouter.get('/sync/:logId', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('redirects_sync_logs')
      .select('*')
      .eq('id', req.params.logId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Sync log not found' });
    }

    res.json({ success: true, syncLog: data });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// List all redirects
redirectsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { search, limit = '50', offset = '0' } = req.query;

    let query = supabase
      .from('redirects')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(parseInt(offset as string, 10), parseInt(offset as string, 10) + parseInt(limit as string, 10) - 1);

    if (search) {
      query = query.or(`original_url.ilike.%${search}%,short_url.ilike.%${search}%,title.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) return res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
    res.json({ success: true, redirects: data, total: count });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

interface ShortIoDomain {
  id: number;
  hostname: string;
}
interface ShortIoLink {
  id: number | string;
  path: string;
  title?: string;
  originalURL: string;
  clicks?: number;
  createdAt: string;
  updatedAt: string;
}

import type { SupabaseClient } from '@supabase/supabase-js';

async function syncShortIoLinks(supabase: SupabaseClient, apiKey: string, domain: string, syncLogId: string) {
  let totalSynced = 0;
  let totalErrors = 0;

  try {
    // Get domain ID
    const domainsResponse = await fetch(`${SHORTIO_API_BASE}/api/domains`, {
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    });

    if (!domainsResponse.ok) throw new Error('Failed to fetch Short.io domains');

    const domains = (await domainsResponse.json()) as ShortIoDomain[];
    const domainData = domains.find((d) => d.hostname === domain);

    if (!domainData) throw new Error(`Domain '${domain}' not found in Short.io account`);

    // Fetch all links with pagination
    let lastId: string | null = null;

    while (true) {
      const url = lastId
        ? `${SHORTIO_API_BASE}/api/links?domain_id=${domainData.id}&limit=150&afterId=${lastId}`
        : `${SHORTIO_API_BASE}/api/links?domain_id=${domainData.id}&limit=150`;

      const response = await fetchWithRetry(url, {
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      });

      if (!response.ok) break;

      const data = (await response.json()) as { links?: ShortIoLink[] };
      const links = data.links ?? [];

      if (links.length === 0) break;

      // Upsert links to database
      for (const link of links) {
        try {
          await supabase.from('redirects').upsert(
            {
              shortio_id: link.id.toString(),
              domain,
              short_url: `https://${domain}/${link.path}`,
              original_url: link.originalURL,
              path: link.path,
              title: link.title || null,
              clicks: link.clicks || 0,
              created_at: link.createdAt,
              updated_at: link.updatedAt,
            },
            { onConflict: 'shortio_id' }
          );
          totalSynced++;
        } catch {
          totalErrors++;
        }
      }

      lastId = String(links[links.length - 1].id);
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    // Update sync log
    await supabase.from('redirects_sync_logs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      links_synced: totalSynced,
      errors: totalErrors,
    }).eq('id', syncLogId);

  } catch (error) {
    logger.error({ err: error }, 'redirect sync error');
    await supabase.from('redirects_sync_logs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: (error instanceof Error ? error.message : String(error)),
      links_synced: totalSynced,
      errors: totalErrors,
    }).eq('id', syncLogId);
  }
}
