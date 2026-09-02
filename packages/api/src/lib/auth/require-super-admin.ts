import type { Request, Response, NextFunction } from 'express';
import { getServiceSupabase } from '../supabase.js';
import { logger } from '../logger.js';

/**
 * Require the caller to hold the `super_admin` platform role.
 *
 * Runs after requireJwt(), which establishes `req.userId`. Authentication says
 * who the caller is; this says what they are allowed to do, and the two are
 * deliberately separate middlewares so a route cannot pick up the second
 * without the first.
 *
 * The role is read with the service-role client rather than the caller's own
 * token. That is not a shortcut: `admin_profiles` is RLS-protected, and the
 * obvious alternative of calling the `is_super_admin()` RPC while passing the
 * user's JWT through `.rpc(..., { headers })` does not work. supabase-js
 * ignores per-call headers there, so the RPC evaluates as the service role and
 * the check silently returns the same answer for everybody. Reading the
 * caller's own role directly is unambiguous.
 *
 * Test bypass matches requireJwt(): with GATEWAZE_TEST_DISABLE_AUTH=1 the api
 * test setup injects a fixed user, so treat that user as authorised rather
 * than making every route test provision an admin_profiles row.
 */
export function requireSuperAdmin() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.GATEWAZE_TEST_DISABLE_AUTH === '1') {
      next();
      return;
    }

    const userId = req.userId;
    if (!userId) {
      // requireJwt() should have run first and rejected. Reaching here means a
      // route was wired with this middleware alone, so fail closed.
      res.status(401).json({
        error: { code: 'unauthenticated', message: 'Authentication required' },
      });
      return;
    }

    try {
      // SERVICE-ROLE OK: reading the caller's own platform role to authorise
      // the request, before any privileged action.
      const { data, error } = await getServiceSupabase()
        .from('admin_profiles')
        .select('role, is_active')
        .eq('user_id', userId)
        .maybeSingle<{ role: string; is_active: boolean }>();

      if (error) {
        logger.error({ err: error, userId }, '[auth] super_admin lookup failed');
        res.status(500).json({
          error: { code: 'INTERNAL_ERROR', message: 'Could not verify permissions' },
        });
        return;
      }

      if (!data || data.is_active === false || data.role !== 'super_admin') {
        res.status(403).json({
          error: {
            code: 'forbidden',
            message: 'This action requires the super_admin role.',
          },
        });
        return;
      }

      next();
    } catch (err) {
      logger.error({ err, userId }, '[auth] super_admin check threw');
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Could not verify permissions' },
      });
    }
  };
}
