import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

/**
 * Helpers shared by every real-Supabase integration test.
 *
 * Tests are SKIPPED when SUPABASE_INTEGRATION is not set so adding
 * files here doesn't break `pnpm test`. The PR workflow sets the env
 * var alongside `supabase start` to enable them.
 */

export const integrationEnabled = process.env.SUPABASE_INTEGRATION === '1';

export interface IntegrationContext {
  service: SupabaseClient;
  url: string;
  jwtSecret: string;
}

export function getContext(): IntegrationContext {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!url || !key || !jwtSecret) {
    throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET must be set');
  }
  return { service: createClient(url, key), url, jwtSecret };
}

/**
 * Mints a Supabase-shaped JWT signed with SUPABASE_JWT_SECRET. The
 * sub claim must match a row in auth.users for the user-scoped
 * client to authenticate.
 */
export function signUserJwt(jwtSecret: string, userId: string, claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: userId,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: now + 3600,
      ...claims,
    },
    jwtSecret,
    { algorithm: 'HS256' },
  );
}

/**
 * Creates an auth.users row + matching public row(s). Returns the
 * generated user id. Service-role client bypasses RLS so this works
 * regardless of tenancy_v2 state.
 */
export async function createTestUser(
  service: SupabaseClient,
  email: string,
  accountId?: string,
): Promise<{ userId: string; email: string }> {
  const userId = randomUUID();
  await service.from('auth.users' as never).insert({
    id: userId,
    email,
    role: 'authenticated',
    aud: 'authenticated',
    instance_id: '00000000-0000-0000-0000-000000000000',
  } as never);
  if (accountId) {
    await service.from('accounts_users').insert({ account_id: accountId, user_id: userId, role: 'member' });
  }
  return { userId, email };
}

export async function createTestAccount(service: SupabaseClient, name: string): Promise<string> {
  const id = randomUUID();
  await service.from('accounts').insert({ id, name });
  return id;
}

export async function setFlag(service: SupabaseClient, key: string, value: string): Promise<void> {
  await service.from('platform_settings').upsert({ key, value });
}

export async function cleanupAccount(service: SupabaseClient, accountId: string): Promise<void> {
  // Cascades remove dependent rows via FK ON DELETE CASCADE.
  await service.from('accounts').delete().eq('id', accountId);
}
