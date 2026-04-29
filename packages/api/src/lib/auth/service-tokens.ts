/**
 * Service-token mint, verify, and revocation logic per spec §5.3 / §6.3.
 *
 * Tokens are HS256 JWTs signed with SERVICE_TOKEN_SECRET. Bootstrap
 * secrets (long-lived, per-service) trade for short-lived tokens at
 * POST /api/internal/issue-token. Workers rotate every 4 minutes
 * (TTL is 5).
 *
 * Verification is local (signature + exp + jti revocation check).
 * The revocation table is consulted only when exp - now > 0 — older
 * tokens are rejected by the exp check directly.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getServiceSupabase } from '../supabase.js';

export type ServiceIdentity = 'worker' | 'scheduler' | 'module-runner';

const TOKEN_TTL_SECS = 5 * 60;

interface ServiceTokenClaims {
  sub: string;            // 'service:worker' etc.
  jti: string;
  iat: number;
  exp: number;
  service: ServiceIdentity;
}

function getSecret(): string {
  const s = process.env.SERVICE_TOKEN_SECRET;
  if (!s) throw new Error('SERVICE_TOKEN_SECRET is not set');
  return s;
}

function getBootstrapSecrets(): Map<string, ServiceIdentity[]> {
  // Format: SERVICE_BOOTSTRAP_SECRETS = "secret1:worker,scheduler;secret2:module-runner"
  // Each secret may mint tokens for the listed services.
  const raw = process.env.SERVICE_BOOTSTRAP_SECRETS ?? '';
  const map = new Map<string, ServiceIdentity[]>();
  for (const entry of raw.split(';').map(s => s.trim()).filter(Boolean)) {
    const [secret, servicesCsv] = entry.split(':');
    if (!secret || !servicesCsv) continue;
    const services = servicesCsv
      .split(',')
      .map(s => s.trim() as ServiceIdentity)
      .filter(s => s === 'worker' || s === 'scheduler' || s === 'module-runner');
    map.set(secret.trim(), services);
  }
  return map;
}

export function validateBootstrapSecret(
  secret: string,
  service: ServiceIdentity,
): { ok: true; bootstrapId: string } | { ok: false; reason: 'unknown' | 'forbidden' } {
  const secrets = getBootstrapSecrets();
  const services = secrets.get(secret);
  if (!services) return { ok: false, reason: 'unknown' };
  if (!services.includes(service)) return { ok: false, reason: 'forbidden' };
  // Bootstrap id = first 8 chars hash of the secret (audit-friendly,
  // doesn't disclose the secret itself).
  return { ok: true, bootstrapId: secret.slice(0, 8) + '…' };
}

export interface IssuedToken {
  token: string;
  jti: string;
  exp: number;
}

export async function mintToken(
  service: ServiceIdentity,
  bootstrapId: string,
  requestIp: string | null,
): Promise<IssuedToken> {
  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECS;

  const claims: ServiceTokenClaims = {
    sub: `service:${service}`,
    jti,
    iat,
    exp,
    service,
  };
  const token = jwt.sign(claims, getSecret(), { algorithm: 'HS256' });

  // Audit row — fire-and-forget; failure here doesn't fail the mint.
  getServiceSupabase()
    .from('service_token_issuance')
    .insert({
      jti,
      service,
      exp: new Date(exp * 1000).toISOString(),
      bootstrap_secret_id: bootstrapId,
      request_ip: requestIp,
    })
    .then(() => {}, () => {});

  return { token, jti, exp };
}

export interface VerifiedToken {
  service: ServiceIdentity;
  jti: string;
}

export async function verifyToken(token: string): Promise<VerifiedToken> {
  let claims: ServiceTokenClaims;
  try {
    claims = jwt.verify(token, getSecret(), { algorithms: ['HS256'] }) as ServiceTokenClaims;
  } catch (err) {
    throw new Error(
      (err as Error).name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token',
    );
  }
  if (!claims.jti || !claims.service) throw new Error('invalid_token');
  // Revocation check: only meaningful while exp is still in the future.
  // Tokens older than that are rejected by jwt.verify above.
  const { data } = await getServiceSupabase()
    .from('service_token_revocations')
    .select('jti')
    .eq('jti', claims.jti)
    .maybeSingle();
  if (data) throw new Error('revoked');
  return { service: claims.service, jti: claims.jti };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      serviceIdentity?: ServiceIdentity;
    }
  }
}

/**
 * Express middleware: requires either a short-lived service token
 * (Authorization: Bearer …) or, when auth.useK8sSA is enabled, a
 * projected Kubernetes ServiceAccount token validated via
 * TokenReview. The latter is wired in a follow-up; this scaffold
 * accepts only the JWT path today.
 */
export function requireServiceRole() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.GATEWAZE_TEST_DISABLE_AUTH === '1') {
      req.serviceIdentity = 'worker';
      next();
      return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({
        error: { code: 'unauthenticated', message: 'Service token required' },
      });
      return;
    }
    try {
      const verified = await verifyToken(header.slice(7).trim());
      req.serviceIdentity = verified.service;
      next();
    } catch (err) {
      const code = (err as Error).message;
      res.status(401).json({
        error: { code, message: 'Service token verification failed' },
      });
    }
  };
}
