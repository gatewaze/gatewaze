/**
 * Admin CRUD for the MCP access model + audit queries
 * (spec-mcp-lfid-access.md §4, §5). Consumed by the admin "API & MCP
 * Access" page. JWT-authed like /api/api-keys, plus an active
 * admin_profiles check (these routes mutate authorization policy).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';
import { getSupabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { resolveAccess } from '../lib/mcp-auth/scopes.js';

export const mcpAdminRouter: Router = labeledRouter('jwt');
mcpAdminRouter.use(requireJwt());

function requireAdmin() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId) return res.status(401).json({ error: { code: 'unauthenticated', message: 'session required' } });
    const { data } = await getSupabase()
      .from('admin_profiles').select('id').eq('user_id', userId).eq('is_active', true).maybeSingle();
    if (!data) return res.status(403).json({ error: { code: 'forbidden', message: 'admin access required' } });
    next();
  };
}
mcpAdminRouter.use(requireAdmin());

const fail = (res: Response, err: unknown, what: string) => {
  logger.error({ err }, `[mcp-admin] ${what} failed`);
  res.status(500).json({ error: { code: 'internal_error', message: `${what} failed` } });
};

// ── Scopes (for pickers): platform API-key scope registry ────────────────
mcpAdminRouter.get('/scopes', async (_req, res) => {
  try {
    // Derive from enabled modules' declared publicApiScopes via the api_keys
    // page convention: read straight from installed modules' manifests is
    // API-side state; simplest faithful source is the distinct scopes already
    // in use plus the well-known set. Keep static + DB-observed union.
    const wellKnown = [
      { scope: 'events:read', description: 'Read published events' },
      { scope: 'events:metrics', description: 'Event registration metrics' },
      { scope: 'calendars:read', description: 'Public calendar directory' },
      { scope: 'blog:read', description: 'Read blog posts' },
      { scope: 'newsletters:read', description: 'Read newsletter editions' },
      { scope: 'resources:read', description: 'Read public resources' },
      { scope: 'resources:write', description: 'Create/manage resources' },
      { scope: 'speakers:read', description: 'Read speaker profiles' },
      { scope: 'sponsors:read', description: 'Read sponsor profiles' },
    ];
    const seen = new Set(wellKnown.map((s) => s.scope));
    const { data } = await getSupabase().from('mcp_access_groups').select('scopes');
    for (const row of data ?? []) {
      for (const s of (row.scopes ?? []) as string[]) {
        if (!seen.has(s)) { wellKnown.push({ scope: s, description: '' }); seen.add(s); }
      }
    }
    res.json({ data: wellKnown });
  } catch (err) { fail(res, err, 'scopes'); }
});

// ── Groups ────────────────────────────────────────────────────────────────
mcpAdminRouter.get('/groups', async (_req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('mcp_access_groups')
      .select('id, name, label, scopes, is_default, is_active, mcp_group_rules(id, kind, match, is_active)')
      .order('created_at');
    if (error) throw new Error(error.message);
    const counts = await supabase.from('mcp_group_members').select('group_id');
    const byGroup = new Map<string, number>();
    for (const m of counts.data ?? []) byGroup.set(m.group_id, (byGroup.get(m.group_id) ?? 0) + 1);
    res.json({
      data: (data ?? []).map((g) => ({
        ...g,
        rules: g.mcp_group_rules ?? [],
        mcp_group_rules: undefined,
        member_count: byGroup.get(g.id) ?? 0,
      })),
    });
  } catch (err) { fail(res, err, 'groups list'); }
});

mcpAdminRouter.post('/groups', async (req, res) => {
  try {
    const { name, label, scopes } = (req.body ?? {}) as { name?: string; label?: string; scopes?: string[] };
    if (!name?.trim() || !label?.trim()) return res.status(400).json({ error: { code: 'validation', message: 'name and label required' } });
    const { data, error } = await getSupabase().from('mcp_access_groups')
      .insert({ name: name.trim().toLowerCase().replace(/\s+/g, '-'), label: label.trim(), scopes: scopes ?? [] })
      .select().single();
    if (error) throw new Error(error.message);
    res.status(201).json({ data });
  } catch (err) { fail(res, err, 'group create'); }
});

mcpAdminRouter.patch('/groups/:id', async (req, res) => {
  try {
    const updates: Record<string, unknown> = {};
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.label === 'string') updates.label = b.label;
    if (Array.isArray(b.scopes)) updates.scopes = b.scopes;
    if (typeof b.is_active === 'boolean') updates.is_active = b.is_active;
    const { data, error } = await getSupabase().from('mcp_access_groups')
      .update(updates).eq('id', req.params.id).select().maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: { code: 'not_found', message: 'group not found' } });
    res.json({ data });
  } catch (err) { fail(res, err, 'group update'); }
});

mcpAdminRouter.delete('/groups/:id', async (req, res) => {
  try {
    const g = await getSupabase().from('mcp_access_groups').select('is_default').eq('id', req.params.id).maybeSingle();
    if (!g.data) return res.status(404).json({ error: { code: 'not_found', message: 'group not found' } });
    if (g.data.is_default) return res.status(400).json({ error: { code: 'protected', message: 'default group cannot be deleted' } });
    const { error } = await getSupabase().from('mcp_access_groups').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'group delete'); }
});

mcpAdminRouter.post('/groups/:id/rules', async (req, res) => {
  try {
    const { kind, match } = (req.body ?? {}) as { kind?: string; match?: string };
    if (kind !== 'email_domain' && kind !== 'all_authenticated') {
      return res.status(400).json({ error: { code: 'validation', message: "kind must be 'email_domain' or 'all_authenticated'" } });
    }
    if (kind === 'email_domain' && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(match ?? '')) {
      return res.status(400).json({ error: { code: 'validation', message: 'valid domain required' } });
    }
    const { data, error } = await getSupabase().from('mcp_group_rules')
      .insert({ group_id: req.params.id, kind, match: kind === 'email_domain' ? match!.toLowerCase() : '' })
      .select().single();
    if (error) throw new Error(error.message);
    res.status(201).json({ data });
  } catch (err) { fail(res, err, 'rule create'); }
});

mcpAdminRouter.delete('/groups/:id/rules/:ruleId', async (req, res) => {
  try {
    const { error } = await getSupabase().from('mcp_group_rules')
      .delete().eq('id', req.params.ruleId).eq('group_id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'rule delete'); }
});

mcpAdminRouter.get('/groups/:id/members', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
    const offset = parseInt(String(req.query.offset)) || 0;
    const { data, error, count } = await getSupabase().from('mcp_group_members')
      .select('person_id, added_at, people(full_name, email)', { count: 'exact' })
      .eq('group_id', req.params.id)
      .order('added_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    res.json({
      data: (data ?? []).map((m) => {
        const p = (Array.isArray(m.people) ? m.people[0] : m.people) as { full_name?: string; email?: string } | null;
        return { person_id: m.person_id, name: p?.full_name ?? null, email: p?.email ?? null, added_at: m.added_at };
      }),
      pagination: { total: count ?? 0, limit, offset, has_more: offset + (data?.length ?? 0) < (count ?? 0) },
    });
  } catch (err) { fail(res, err, 'members list'); }
});

mcpAdminRouter.post('/groups/:id/members', async (req, res) => {
  try {
    const { person_id } = (req.body ?? {}) as { person_id?: string };
    if (!person_id) return res.status(400).json({ error: { code: 'validation', message: 'person_id required' } });
    const userId = (req as { userId?: string }).userId;
    const { error } = await getSupabase().from('mcp_group_members')
      .upsert({ group_id: req.params.id, person_id, added_by: userId ?? null });
    if (error) throw new Error(error.message);
    res.status(201).json({ ok: true });
  } catch (err) { fail(res, err, 'member add'); }
});

mcpAdminRouter.delete('/groups/:id/members/:personId', async (req, res) => {
  try {
    const { error } = await getSupabase().from('mcp_group_members')
      .delete().eq('group_id', req.params.id).eq('person_id', req.params.personId);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'member remove'); }
});

// ── Per-person access ─────────────────────────────────────────────────────
mcpAdminRouter.get('/people/:personId/access', async (req, res) => {
  try {
    const supabase = getSupabase();
    const person = await supabase.from('people').select('id, email, full_name').eq('id', req.params.personId).maybeSingle();
    if (!person.data) return res.status(404).json({ error: { code: 'not_found', message: 'person not found' } });
    const access = await resolveAccess(supabase, person.data.id, person.data.email ?? '');
    const grants = await supabase.from('mcp_person_grants')
      .select('scopes_add, scopes_remove, note').eq('person_id', person.data.id).maybeSingle();
    res.json({
      data: {
        person: { id: person.data.id, name: person.data.full_name, email: person.data.email },
        effective_scopes: access.scopes,
        derivation: access.derivation,
        groups: access.groups,
        grants: grants.data ?? null,
      },
    });
  } catch (err) { fail(res, err, 'person access'); }
});

mcpAdminRouter.put('/people/:personId/grants', async (req, res) => {
  try {
    const b = (req.body ?? {}) as { scopes_add?: string[]; scopes_remove?: string[]; note?: string };
    const userId = (req as { userId?: string }).userId;
    const { data, error } = await getSupabase().from('mcp_person_grants').upsert({
      person_id: req.params.personId,
      scopes_add: Array.isArray(b.scopes_add) ? b.scopes_add : [],
      scopes_remove: Array.isArray(b.scopes_remove) ? b.scopes_remove : [],
      note: b.note ?? null,
      updated_by: userId ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    res.json({ data });
  } catch (err) { fail(res, err, 'grants update'); }
});

// ── Sessions ──────────────────────────────────────────────────────────────
mcpAdminRouter.get('/sessions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
    const offset = parseInt(String(req.query.offset)) || 0;
    let q = getSupabase().from('mcp_sessions')
      .select('id, person_id, email, auth_mode, client_id, client_name, scopes, issued_at, last_refreshed_at, last_seen_at, expires_at, revoked_at, people(full_name)', { count: 'exact' })
      .order('issued_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (req.query.person_id) q = q.eq('person_id', String(req.query.person_id));
    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    res.json({
      data: (data ?? []).map((s) => {
        const p = (Array.isArray(s.people) ? s.people[0] : s.people) as { full_name?: string } | null;
        return { ...s, people: undefined, person_name: p?.full_name ?? null };
      }),
      pagination: { total: count ?? 0, limit, offset, has_more: offset + (data?.length ?? 0) < (count ?? 0) },
    });
  } catch (err) { fail(res, err, 'sessions list'); }
});

mcpAdminRouter.delete('/sessions/:id', async (req, res) => {
  try {
    const { error } = await getSupabase().from('mcp_sessions')
      .update({ revoked_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'session revoke'); }
});

// ── Activity ──────────────────────────────────────────────────────────────
mcpAdminRouter.get('/activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
    const offset = parseInt(String(req.query.offset)) || 0;
    let q = getSupabase().from('mcp_request_log')
      .select('ts, identity_kind, subject, email, person_id, tier, ip, client_name, era, tool, args, outcome, error, ms, bytes, rows', { count: 'exact' })
      .order('ts', { ascending: false })
      .range(offset, offset + limit - 1);
    if (req.query.person_id) q = q.eq('person_id', String(req.query.person_id));
    if (req.query.tool) q = q.eq('tool', String(req.query.tool));
    if (req.query.outcome) q = q.eq('outcome', String(req.query.outcome));
    if (req.query.from) q = q.gte('ts', String(req.query.from));
    if (req.query.to) q = q.lte('ts', String(req.query.to));
    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    res.json({
      data: data ?? [],
      pagination: { total: count ?? 0, limit, offset, has_more: offset + (data?.length ?? 0) < (count ?? 0) },
    });
  } catch (err) { fail(res, err, 'activity query'); }
});
