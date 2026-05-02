import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ActiveAccountResolution {
  accountId: string;
  source: 'header' | 'jwt-claim' | 'first-membership';
}

export class NoAccountMembershipError extends Error {
  constructor(public readonly userId: string) {
    super(`User ${userId} has no account membership`);
    this.name = 'NoAccountMembershipError';
  }
}

export class HeaderAccountMismatchError extends Error {
  constructor(public readonly userId: string, public readonly accountId: string) {
    super(`User ${userId} is not a member of account ${accountId}`);
    this.name = 'HeaderAccountMismatchError';
  }
}

/**
 * Resolves the active account for a request, in order:
 *   1. X-Gatewaze-Account header (UUID), validated against accounts_users.
 *   2. active_account_id JWT claim, validated against accounts_users.
 *   3. The user's first account by accounts_users.created_at.
 *
 * accounts_users keys membership by admin_profile_id (FK to admin_profiles.id),
 * not the raw auth user_id. We resolve the auth user → admin_profile.id
 * first, then look up memberships. Cached per-call via two queries; the
 * service-role client bypasses RLS for both.
 *
 * The DB call uses the service-role client because the active-account check
 * runs *before* the user-scoped client is constructed for a request. This
 * lookup is the only service-role read in the request path; it is bounded
 * to (account_id, admin_profile_id) keys and discloses nothing beyond
 * membership.
 */
export async function resolveActiveAccount(
  req: Request,
  userId: string,
  jwtClaims: Record<string, unknown>,
  serviceClient: SupabaseClient,
): Promise<ActiveAccountResolution> {
  const headerAccountId = (req.headers['x-gatewaze-account'] as string | undefined)?.trim();
  const claimAccountId = typeof jwtClaims['active_account_id'] === 'string'
    ? (jwtClaims['active_account_id'] as string).trim()
    : undefined;

  // Resolve auth user → admin_profile.id once. Without an admin profile,
  // the user can't be a member of any account (the FK is admin_profile_id).
  const profileId = await resolveAdminProfileId(serviceClient, userId);
  if (!profileId) throw new NoAccountMembershipError(userId);

  if (headerAccountId) {
    if (!UUID_RE.test(headerAccountId)) {
      throw new HeaderAccountMismatchError(userId, headerAccountId);
    }
    const ok = await isMember(serviceClient, profileId, headerAccountId);
    if (!ok) throw new HeaderAccountMismatchError(userId, headerAccountId);
    return { accountId: headerAccountId, source: 'header' };
  }

  if (claimAccountId && UUID_RE.test(claimAccountId)) {
    const ok = await isMember(serviceClient, profileId, claimAccountId);
    if (ok) return { accountId: claimAccountId, source: 'jwt-claim' };
  }

  const { data, error } = await serviceClient
    .from('accounts_users')
    .select('account_id, created_at')
    .eq('admin_profile_id', profileId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NoAccountMembershipError(userId);
  return { accountId: data.account_id as string, source: 'first-membership' };
}

async function resolveAdminProfileId(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await client
    .from('admin_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  return data ? (data.id as string) : null;
}

async function isMember(client: SupabaseClient, adminProfileId: string, accountId: string): Promise<boolean> {
  const { data } = await client
    .from('accounts_users')
    .select('account_id')
    .eq('admin_profile_id', adminProfileId)
    .eq('account_id', accountId)
    .maybeSingle();
  return !!data;
}
