/**
 * Redirects API Routes
 *
 * Short-link management: bulk creation via a pluggable provider (self-hosted
 * Umami Links or Short.io), plus the legacy Short.io sync/list endpoints.
 *
 * POST /create-bulk is what the newsletters admin's linkService calls when
 * generating edition short links. Provider resolution:
 *   body.provider ('redirects-umami' | 'redirects-shortio')
 *   → else umami when UMAMI_PASSWORD is configured
 *   → else shortio when SHORTIO_API_KEY is configured.
 *
 * Umami links redirect via the analytics module's public proxy route
 * (GET /a/q/:slug on this API host) since Umami itself stays
 * cluster-internal.
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

// ---------------------------------------------------------------------------
// Umami Links provider
// ---------------------------------------------------------------------------

interface BulkLinkInput {
  path: string;
  originalUrl: string;
  title?: string;
}

interface BulkLinkResult {
  path: string;
  originalUrl: string;
  success: boolean;
  isNew?: boolean;
  shortUrl?: string;
  /** Provider link id — field name is historical (Short.io was first). */
  shortioId?: string;
  redirectId?: string;
  error?: string;
}

const SLUG_RE = /^[A-Za-z0-9._~-]{1,80}$/;

/** Umami's link slug column is varchar(100); the internal slug embeds the
 *  serving host so every domain gets its own slug space:
 *  `${domain}--${slug}` → served at https://{domain}/go/{slug}. */
function internalSlug(domain: string, slug: string): string {
  return `${domain}--${slug}`;
}

function shortUrlFor(domain: string, slug: string): string {
  const proto = domain.endsWith('.localhost') || domain === 'localhost' ? 'http' : 'https';
  return `${proto}://${domain}/go/${slug}`;
}

let umamiToken: { value: string; expiresAt: number } | null = null;

async function umamiLogin(baseUrl: string): Promise<string> {
  if (umamiToken && umamiToken.expiresAt > Date.now()) return umamiToken.value;
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.UMAMI_USERNAME || 'admin',
      password: process.env.UMAMI_PASSWORD || '',
    }),
  });
  if (!res.ok) throw new Error(`umami login failed: ${res.status}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('umami login returned no token');
  umamiToken = { value: body.token, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  return body.token;
}

interface UmamiLink { id: string; name: string; url: string; slug: string }

/** Find an existing umami link by exact slug (the create API 400s on
 *  duplicate slugs rather than upserting). */
async function findUmamiLinkBySlug(baseUrl: string, token: string, slug: string): Promise<UmamiLink | null> {
  const res = await fetch(`${baseUrl}/api/links?search=${encodeURIComponent(slug)}&pageSize=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: UmamiLink[] };
  return (body.data ?? []).find((l) => l.slug === slug) ?? null;
}

async function createUmamiLink(baseUrl: string, token: string, link: BulkLinkInput): Promise<{ link: UmamiLink; isNew: boolean }> {
  const existing = await findUmamiLinkBySlug(baseUrl, token, link.path);
  if (existing) {
    if (existing.url !== link.originalUrl) {
      // Point the existing slug at the new destination.
      const upd = await fetch(`${baseUrl}/api/links/${existing.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: link.title || link.path, url: link.originalUrl, slug: link.path }),
      });
      if (!upd.ok) throw new Error(`umami link update failed: ${upd.status}`);
    }
    return { link: { ...existing, url: link.originalUrl }, isNew: false };
  }
  const res = await fetch(`${baseUrl}/api/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    // umami caps url at varchar(500) — reject early with a clear error.
    body: JSON.stringify({ name: (link.title || link.path).slice(0, 100), url: link.originalUrl, slug: link.path }),
  });
  if (!res.ok) throw new Error(`umami link create failed: ${res.status} ${(await res.text()).slice(0, 120)}`);
  return { link: (await res.json()) as UmamiLink, isNew: true };
}

// Bulk-create short links (called by newsletters linkService when
// generating edition links).
redirectsRouter.post('/create-bulk', async (req: Request, res: Response) => {
  const { links, provider: requestedProvider, domain } = req.body as {
    links?: BulkLinkInput[];
    provider?: string;
    domain?: string;
  };
  if (!Array.isArray(links) || links.length === 0) {
    return res.status(400).json({ error: 'links array is required' });
  }
  if (links.length > 500) {
    return res.status(400).json({ error: 'at most 500 links per call' });
  }

  const provider =
    requestedProvider === 'redirects-umami' || requestedProvider === 'redirects-shortio'
      ? requestedProvider
      : process.env.UMAMI_PASSWORD
        ? 'redirects-umami'
        : process.env.SHORTIO_API_KEY
          ? 'redirects-shortio'
          : null;
  if (!provider) {
    return res.status(503).json({ error: 'No short-link provider configured (UMAMI_PASSWORD or SHORTIO_API_KEY)' });
  }
  if (provider === 'redirects-shortio') {
    // The legacy Short.io path still goes through the admin-side adapter +
    // /sync; server-side shortio bulk-create is not implemented here.
    return res.status(501).json({ error: 'shortio create-bulk not implemented server-side; use the Short.io adapter' });
  }

  // Short links are served on the PORTAL/site host at /go/<slug> — never
  // the API host. Callers say which host (per-site links); default is the
  // brand's portal host.
  const linkDomain = (typeof domain === 'string' && domain.trim())
    ? domain.trim().toLowerCase()
    : (process.env.PORTAL_HOST || '').toLowerCase();
  if (!linkDomain) {
    return res.status(400).json({ error: 'domain required (no PORTAL_HOST fallback configured)' });
  }

  const supabase = getSupabase();
  const baseUrl = (process.env.UMAMI_BASE_URL || 'http://umami:3000').replace(/\/+$/, '');
  const results: BulkLinkResult[] = [];
  let created = 0;
  let updated = 0;
  let errors = 0;

  let token: string;
  try {
    token = await umamiLogin(baseUrl);
  } catch (e) {
    return res.status(502).json({ error: `umami unavailable: ${e instanceof Error ? e.message : String(e)}` });
  }

  for (const link of links) {
    const scoped = link?.path ? internalSlug(linkDomain, link.path) : '';
    if (!link?.path || !SLUG_RE.test(link.path) || scoped.length > 100 || !link.originalUrl || link.originalUrl.length > 500) {
      results.push({
        path: link?.path ?? '', originalUrl: link?.originalUrl ?? '', success: false,
        error: 'invalid path (slug chars, ≤80, domain+slug ≤100) or originalUrl (required, ≤500 chars)',
      });
      errors++;
      continue;
    }
    try {
      const { link: uLink, isNew } = await createUmamiLink(baseUrl, token, { ...link, path: scoped });
      const shortUrl = shortUrlFor(linkDomain, link.path);
      const { data: row } = await supabase
        .from('redirects')
        .upsert(
          {
            shortio_id: uLink.id,
            provider: 'umami',
            domain: linkDomain,
            short_url: shortUrl,
            original_url: link.originalUrl,
            path: link.path,
            title: link.title || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'shortio_id' },
        )
        .select('id')
        .maybeSingle();
      results.push({
        path: link.path,
        originalUrl: link.originalUrl,
        success: true,
        isNew,
        shortUrl,
        shortioId: uLink.id,
        redirectId: (row as { id?: string } | null)?.id,
      });
      if (isNew) created++; else updated++;
    } catch (e) {
      results.push({
        path: link.path, originalUrl: link.originalUrl, success: false,
        error: e instanceof Error ? e.message : String(e),
      });
      errors++;
    }
  }

  res.json({ success: errors === 0, provider, created, updated, errors, results });
});

// Per-link click stats (umami-provider links) — clicks are ordinary
// Umami events keyed by the link id.
redirectsRouter.get('/link/:redirectId/stats', async (req: Request, res: Response) => {
  const { redirectId } = req.params;
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('redirects')
    .select('shortio_id, provider')
    .eq('id', redirectId)
    .maybeSingle();
  if (!row) return res.status(404).json({ error: 'redirect not found' });
  if (row.provider !== 'umami') return res.status(400).json({ error: 'stats only available for umami links' });

  const baseUrl = (process.env.UMAMI_BASE_URL || 'http://umami:3000').replace(/\/+$/, '');
  try {
    const token = await umamiLogin(baseUrl);
    const to = Date.now();
    const from = to - 90 * 24 * 60 * 60 * 1000;
    const r = await fetch(`${baseUrl}/api/websites/${row.shortio_id}/stats?startAt=${from}&endAt=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return res.status(502).json({ error: `umami responded ${r.status}` });
    const stats = (await r.json()) as { pageviews?: unknown; visitors?: unknown };
    const num = (v: unknown) => (typeof v === 'number' ? v : (v as { value?: number } | null)?.value ?? 0);
    res.json({ clicks: num(stats.pageviews), unique_visitors: num(stats.visitors), range_days: 90 });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Delete a short link (provider-aware: removes the umami link too).
redirectsRouter.delete('/link/:redirectId', async (req: Request, res: Response) => {
  const { redirectId } = req.params;
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('redirects')
    .select('id, shortio_id, provider')
    .eq('id', redirectId)
    .maybeSingle();
  if (!row) return res.status(404).json({ error: 'redirect not found' });

  if (row.provider === 'umami') {
    const baseUrl = (process.env.UMAMI_BASE_URL || 'http://umami:3000').replace(/\/+$/, '');
    try {
      const token = await umamiLogin(baseUrl);
      await fetch(`${baseUrl}/api/links/${row.shortio_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      logger.warn({ err: e }, 'umami link delete failed (removing row anyway)');
    }
  }
  await supabase.from('redirects').delete().eq('id', row.id);
  res.status(204).send();
});

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
    const { search, domain, provider, limit = '50', offset = '0' } = req.query;

    let query = supabase
      .from('redirects')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(parseInt(offset as string, 10), parseInt(offset as string, 10) + parseInt(limit as string, 10) - 1);

    if (typeof domain === 'string' && domain) query = query.eq('domain', domain.toLowerCase());
    if (typeof provider === 'string' && provider) query = query.eq('provider', provider);

    if (search) {
      // Strip PostgREST filter-grammar metacharacters before interpolation.
      // Without this, a `,` or `(` in `search` injects additional disjunction
      // clauses into the .or() string and can return rows the user shouldn't see.
      const safe = String(search).replace(/[,()*\\]/g, '').slice(0, 100);
      if (safe) {
        query = query.or(`original_url.ilike.%${safe}%,short_url.ilike.%${safe}%,title.ilike.%${safe}%`);
      }
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
