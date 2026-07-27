/**
 * First-contact provisioning (spec-mcp-lfid-access.md §3.1).
 *
 * Guarantees an auth.users row and a people row exist for the
 * authenticated identity BEFORE tier resolution, reusing the platform's
 * canonical reconciliation primitives — never parallel person-creation
 * logic (duplicate-people avoidance is load-bearing; see the prod
 * people-merge history):
 *
 *   1. person_emails alias lookup — a plus-addressed or secondary email
 *      resolves to its owning person instead of creating a duplicate.
 *   2. people_upsert_with_auth RPC — lowercased canonical email upsert
 *      (ON CONFLICT (email) DO UPDATE), the same primitive sign-in paths
 *      use.
 *
 * New people are stamped with acquisition source 'mcp' in attributes so
 * MCP-first users are visible as a channel. contact_kind is left to the
 * table default (self-initiated sign-in must NOT create 'prospect' rows).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProvisionResult {
  personId: string;
  authUserId: string;
  created: boolean;
}

export async function ensureAuthAndPerson(
  supabase: SupabaseClient,
  opts: {
    email: string;
    /** Existing auth user id when the login flow already produced one (magic link). */
    authUserId?: string;
    /** LFID sub, stored on the auth user metadata in lfid mode. */
    lfidSub?: string;
    displayName?: string;
  },
): Promise<ProvisionResult> {
  const email = opts.email.trim().toLowerCase();

  // ── auth.users ─────────────────────────────────────────────────────────
  let authUserId = opts.authUserId ?? null;
  if (!authUserId) {
    // LFID mode: find-or-create the auth user by email. listUsers has no
    // email filter pre-v2; use the admin generateLink trick's underlying
    // lookup instead: try createUser and fall back to lookup on conflict.
    const created = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        ...(opts.lfidSub ? { lfid_sub: opts.lfidSub } : {}),
        ...(opts.displayName ? { full_name: opts.displayName } : {}),
      },
    });
    if (created.data.user) {
      authUserId = created.data.user.id;
    } else {
      // Already exists — resolve id via generateLink (returns the user
      // without sending anything).
      const link = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
      if (link.error || !link.data.user) {
        throw new Error(`auth user resolution failed: ${created.error?.message ?? link.error?.message}`);
      }
      authUserId = link.data.user.id;
      if (opts.lfidSub) {
        await supabase.auth.admin.updateUserById(authUserId, {
          user_metadata: { lfid_sub: opts.lfidSub },
        });
      }
    }
  }

  // ── people (alias-aware) ───────────────────────────────────────────────
  const alias = await supabase
    .from('person_emails')
    .select('person_id')
    .eq('email', email)
    .maybeSingle();
  if (alias.data?.person_id) {
    return { personId: alias.data.person_id as string, authUserId: authUserId!, created: false };
  }

  const existing = await supabase.from('people').select('id').eq('email', email).maybeSingle();
  if (existing.data?.id) {
    return { personId: existing.data.id as string, authUserId: authUserId!, created: false };
  }

  const upserted = await supabase.rpc('people_upsert_with_auth', {
    p_cio_id: null,
    p_email: email,
    p_attributes: {
      source: 'mcp',
      ...(opts.displayName ? { full_name: opts.displayName } : {}),
      ...(opts.lfidSub ? { lfid_sub: opts.lfidSub } : {}),
    },
  });
  if (upserted.error) throw new Error(`person provisioning failed: ${upserted.error.message}`);
  return { personId: upserted.data as string, authUserId: authUserId!, created: true };
}
