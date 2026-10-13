/**
 * Backend half of issue #94 ("notify users when a newer app version/build
 * is available to install").
 *
 * The mobile app's own bundle can only ever describe builds up to and
 * including itself (src/core/changelog.ts), so "is there a build newer than
 * me" has to be a live round trip to a backend that is updated at release
 * time. app_releases is written by
 * packages/mobile/scripts/testflight-release-build.mjs once Apple confirms
 * a build is live for testers; this route is the read side a device calls.
 */

import { type Request, type Response } from 'express';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';
import { getServiceSupabase } from '../lib/supabase.js';

export const appReleasesRouter = labeledRouter('jwt');
appReleasesRouter.use(requireJwt());

const PLATFORMS = new Set(['ios', 'android']);

interface AppReleaseRow {
  latest_version: string;
  latest_build: number;
}

appReleasesRouter.get('/latest', async (req: Request, res: Response) => {
  const platform = String(req.query.platform ?? '');
  if (!PLATFORMS.has(platform)) {
    return res.status(400).json({ error: { code: 'invalid_platform', message: 'platform must be ios or android' } });
  }

  // SERVICE-ROLE OK: account scoping is applied explicitly below from
  // req.accountId, which requireJwt() already resolved server-side from
  // the verified session — never from this query string.
  const db = getServiceSupabase();
  const { data, error } = await db
    .from('app_releases')
    .select('latest_version, latest_build')
    .eq('account_id', req.accountId)
    .eq('platform', platform)
    .maybeSingle<AppReleaseRow>();

  if (error) {
    return res.status(500).json({ error: { code: 'internal', message: 'Could not check for an update.' } });
  }
  if (!data) return res.json(null);
  return res.json({ version: data.latest_version, build: data.latest_build });
});
