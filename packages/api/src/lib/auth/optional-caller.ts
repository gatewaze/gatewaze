import type { Request, Response } from 'express';
import { requireJwt } from './require-jwt.js';
import { getServiceSupabase } from '../supabase.js';
import { logger } from '../logger.js';

export type Caller = { kind: 'anon' } | { kind: 'authenticated'; userId: string };

/**
 * Who is calling a route that also serves signed-out visitors.
 *
 * A request with a token that requireJwt() accepts is `authenticated`;
 * anything else (no token, a bad or expired one, no account membership once
 * tenancy is enforced) is `anon`. The token is verified by requireJwt()
 * itself, so this can never be looser than the JWT-labelled routes.
 */
export function resolveOptionalCaller(req: Request): Promise<Caller> {
  return new Promise<Caller>((resolvePromise) => {
    let settled = false;
    const done = (caller: Caller) => {
      if (settled) return;
      settled = true;
      resolvePromise(caller);
    };
    // requireJwt() answers a rejected token with res.status(..).json(..).
    // Capture that as "anon" instead of sending it.
    const shim = {
      status: () => shim,
      json: () => {
        done({ kind: 'anon' });
        return shim;
      },
      setHeader: () => shim,
    } as unknown as Response;
    requireJwt()(req, shim, () => {
      done(req.userId ? { kind: 'authenticated', userId: req.userId } : { kind: 'anon' });
    }).catch(() => done({ kind: 'anon' }));
  });
}

/** The roles public.is_admin() accepts (supabase/migrations/00036_portal_manager_role.sql). */
const ADMIN_ROLES = ['super_admin', 'admin', 'editor'];

/**
 * The same answer public.is_admin() gives for this user: an active
 * admin_profiles row with an admin role. Fails closed.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    // SERVICE-ROLE OK: reading the caller's own platform role to authorise
    // the request, before any privileged action. admin_profiles is RLS-
    // protected, so the caller's own client cannot read it reliably.
    const { data, error } = await getServiceSupabase()
      .from('admin_profiles')
      .select('role, is_active')
      .eq('user_id', userId)
      .maybeSingle<{ role: string; is_active: boolean }>();
    if (error) {
      logger.error({ err: error, userId }, '[auth] admin lookup failed');
      return false;
    }
    return Boolean(data && data.is_active === true && ADMIN_ROLES.includes(data.role));
  } catch (err) {
    logger.error({ err, userId }, '[auth] admin lookup threw');
    return false;
  }
}
