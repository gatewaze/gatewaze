/**
 * Effective-scope resolution (spec-mcp-lfid-access.md §2, §4).
 *
 * effective = union(scopes of every ACTIVE group the person matches)
 *             ∪ person.scopes_add − person.scopes_remove
 *
 * Group matching: an active rule of kind 'all_authenticated', an active rule
 * of kind 'email_domain' equal to the verified email's domain (lowercased),
 * or an explicit mcp_group_members row. Deterministic and order-independent;
 * `derivation` records where each scope came from for the admin UI.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolvedAccess {
  scopes: string[];
  groups: Array<{ id: string; name: string; label: string }>;
  derivation: Array<{ scope: string; via: string }>;
}

export async function resolveAccess(
  supabase: SupabaseClient,
  personId: string,
  email: string,
): Promise<ResolvedAccess> {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';

  const [groupsRes, membershipRes, grantsRes] = await Promise.all([
    supabase
      .from('mcp_access_groups')
      .select('id, name, label, scopes, is_active, mcp_group_rules(kind, match, is_active)')
      .eq('is_active', true),
    supabase.from('mcp_group_members').select('group_id').eq('person_id', personId),
    supabase.from('mcp_person_grants').select('scopes_add, scopes_remove').eq('person_id', personId).maybeSingle(),
  ]);
  if (groupsRes.error) throw new Error(groupsRes.error.message);
  if (membershipRes.error) throw new Error(membershipRes.error.message);
  if (grantsRes.error) throw new Error(grantsRes.error.message);

  const memberOf = new Set((membershipRes.data ?? []).map((m) => m.group_id as string));
  const matched: Array<{ id: string; name: string; label: string; scopes: string[]; via: string }> = [];

  for (const g of groupsRes.data ?? []) {
    const rules = (g.mcp_group_rules ?? []) as Array<{ kind: string; match: string; is_active: boolean }>;
    let via: string | null = null;
    if (memberOf.has(g.id)) via = 'membership';
    else if (rules.some((r) => r.is_active && r.kind === 'all_authenticated')) via = 'rule:all_authenticated';
    else if (domain && rules.some((r) => r.is_active && r.kind === 'email_domain' && r.match.toLowerCase() === domain)) {
      via = `rule:email_domain=${domain}`;
    }
    if (via) matched.push({ id: g.id, name: g.name, label: g.label, scopes: g.scopes ?? [], via });
  }

  const derivation: Array<{ scope: string; via: string }> = [];
  const scopeSet = new Set<string>();
  for (const g of matched) {
    for (const s of g.scopes) {
      if (!scopeSet.has(s)) derivation.push({ scope: s, via: `${g.label} (${g.via})` });
      scopeSet.add(s);
    }
  }

  const grants = grantsRes.data as { scopes_add: string[]; scopes_remove: string[] } | null;
  for (const s of grants?.scopes_add ?? []) {
    if (!scopeSet.has(s)) derivation.push({ scope: s, via: 'personal grant' });
    scopeSet.add(s);
  }
  for (const s of grants?.scopes_remove ?? []) scopeSet.delete(s);

  return {
    scopes: [...scopeSet].sort(),
    groups: matched.map(({ id, name, label }) => ({ id, name, label })),
    derivation: derivation.filter((d) => scopeSet.has(d.scope)),
  };
}
