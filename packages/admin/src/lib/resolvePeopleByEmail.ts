import { supabase } from '@/lib/supabase';

/**
 * Resolve a set of email addresses to person ids, returning a map keyed by
 * LOWERCASED email. Checks `person_emails` (the identity/alias table — a person
 * can own many addresses) first, then falls back to `people.email`. Case is
 * normalised on both sides, so a mixed-case reply address still matches.
 *
 * Returns an empty map when there are no emails (no query is issued).
 */
export async function resolvePeopleByEmail(emails: (string | null | undefined)[]): Promise<Record<string, string>> {
  const distinct = Array.from(
    new Set(emails.filter((e): e is string => !!e).map((e) => e.trim()).filter(Boolean)),
  );
  if (distinct.length === 0) return {};

  // Query both the original and lowercased forms so we match regardless of how
  // the address happens to be stored.
  const variants = Array.from(new Set(distinct.flatMap((e) => [e, e.toLowerCase()])));

  const [peopleRes, aliasRes] = await Promise.all([
    supabase.from('people').select('id, email').in('email', variants),
    supabase.from('person_emails').select('person_id, email').in('email', variants),
  ]);

  const map: Record<string, string> = {};
  // people first (fallback), then person_emails (authoritative — wins).
  for (const row of (peopleRes.data as { id: string; email: string | null }[] | null) || []) {
    if (row.email && row.id) map[row.email.toLowerCase()] = row.id;
  }
  for (const row of (aliasRes.data as { person_id: string; email: string | null }[] | null) || []) {
    if (row.email && row.person_id) map[row.email.toLowerCase()] = row.person_id;
  }
  return map;
}
