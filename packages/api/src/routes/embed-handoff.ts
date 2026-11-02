import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { labeledRouter } from '../lib/router-registry.js';
import { getSupabase } from '../lib/supabase.js';
import { ipRateLimiter } from '../lib/rate-limiter.js';
import { getRedisConnection, isRedisConfigured } from '../lib/queue/index.js';
import { logger } from '../lib/logger.js';

/**
 * Sign-in handoff for portal embeds (`/embed/<widget>` in an iframe on
 * another site).
 *
 * The iframe cannot use the portal's session: browsers partition a
 * third-party iframe's storage and cookies away from the same site opened
 * directly. So the embed signs in through a first-party popup and the popup
 * hands the iframe an access token through here:
 *
 *   1. The iframe makes a random secret and opens the popup with
 *      challenge = sha256(secret). Only the iframe knows the secret.
 *   2. After LFID sign-in the popup POSTs /deposit with its own access
 *      token (Authorization) and the challenge.
 *   3. The iframe polls POST /claim with the secret. The first claim gets
 *      the token; the entry is deleted as it is read.
 *
 * Only the access token is handed over, never the refresh token: two
 * sessions sharing one refresh token would trip Supabase's reuse detection
 * and sign the user out of both. When the token expires the embed simply
 * runs the popup again, which is instant while the portal session lives.
 *
 * Entries live for two minutes. Redis when configured (multi-replica safe),
 * otherwise in process memory, which is the only shape a single-replica
 * deployment without Redis has.
 */

const TTL_SECONDS = 120;
const KEY_PREFIX = 'gatewaze:embed-handoff:';
const CHALLENGE_RE = /^[0-9a-f]{64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

interface Handoff {
  access_token: string;
  expires_at: number | null;
}

const memory = new Map<string, { value: string; expiresAt: number }>();

async function put(challenge: string, value: Handoff): Promise<boolean> {
  const key = KEY_PREFIX + challenge;
  const json = JSON.stringify(value);
  if (isRedisConfigured()) {
    // NX: a challenge is used once; a second deposit cannot replace the first.
    const res = await getRedisConnection().set(key, json, 'EX', TTL_SECONDS, 'NX');
    return res === 'OK';
  }
  const now = Date.now();
  for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
  if (memory.has(key)) return false;
  memory.set(key, { value: json, expiresAt: now + TTL_SECONDS * 1000 });
  return true;
}

async function take(challenge: string): Promise<Handoff | null> {
  const key = KEY_PREFIX + challenge;
  let json: string | null = null;
  if (isRedisConfigured()) {
    json = await getRedisConnection().getdel(key);
  } else {
    const hit = memory.get(key);
    memory.delete(key);
    json = hit && hit.expiresAt > Date.now() ? hit.value : null;
  }
  if (!json) return null;
  try {
    return JSON.parse(json) as Handoff;
  } catch {
    return null;
  }
}

/** The token's exp claim. Only read after Supabase Auth has verified the token. */
function expiryOf(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
    return Number.isFinite(payload?.exp) ? Number(payload.exp) : null;
  } catch {
    return null;
  }
}

export function challengeFor(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// The portal proxies these to us, so a busy portal shares one client IP;
// the limits are sized for that.
const depositLimit = ipRateLimiter({ points: 120, durationSecs: 60, bucket: 'embed-handoff-deposit' });
const claimLimit = ipRateLimiter({ points: 600, durationSecs: 60, bucket: 'embed-handoff-claim' });

/** POST /api/public/embed-handoff/deposit — the popup, signed in. */
export const embedHandoffDepositRouter = labeledRouter('jwt');
embedHandoffDepositRouter.post('/', depositLimit, async (req: Request, res: Response) => {
  const challenge = typeof req.body?.challenge === 'string' ? req.body.challenge : '';
  if (!CHALLENGE_RE.test(challenge)) {
    res.status(400).json({ error: { code: 'bad_challenge', message: 'challenge must be 64 hex characters' } });
    return;
  }
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in first' } });
    return;
  }
  try {
    // Any signed-in portal user, checked with Supabase Auth itself. Not
    // requireJwt(): that is the admin-route check and can demand an account
    // membership that portal users do not have.
    const { data, error } = await getSupabase().auth.getUser(token);
    if (error || !data?.user) {
      res.status(401).json({ error: { code: 'invalid_token', message: 'Sign-in could not be verified' } });
      return;
    }
    const exp = expiryOf(token);
    const stored = await put(challenge, { access_token: token, expires_at: exp });
    if (!stored) {
      res.status(409).json({ error: { code: 'already_used', message: 'This sign-in link was already used' } });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'embed-handoff: deposit failed');
    res.status(503).json({ error: { code: 'unavailable', message: 'Sign-in handoff is unavailable' } });
  }
});

/** POST /api/public/embed-handoff/claim — the iframe, holding the secret. */
export const embedHandoffClaimRouter = labeledRouter('public');
embedHandoffClaimRouter.post('/', claimLimit, async (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  const secret = typeof req.body?.secret === 'string' ? req.body.secret : '';
  if (!SECRET_RE.test(secret)) {
    res.status(400).json({ error: { code: 'bad_secret', message: 'secret must be 43 base64url characters' } });
    return;
  }
  try {
    const handoff = await take(challengeFor(secret));
    if (!handoff) {
      res.status(404).json({ pending: true });
      return;
    }
    res.json(handoff);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'embed-handoff: claim failed');
    res.status(503).json({ error: { code: 'unavailable', message: 'Sign-in handoff is unavailable' } });
  }
});
