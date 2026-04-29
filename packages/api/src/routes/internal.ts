/**
 * /api/internal/* — service-to-service mint endpoint per spec §5.3.
 *
 * Authentication: bootstrap secret in Authorization: Bearer header.
 * The bootstrap secret is the only credential allowed here; standard
 * user JWTs are explicitly rejected. The router is labeled 'public'
 * (no requireJwt mount) but the issue handler does its own auth.
 */

import type { Request, Response } from 'express';
import { labeledRouter } from '../lib/router-registry.js';
import { ValidationError } from '../lib/errors.js';
import {
  mintToken,
  validateBootstrapSecret,
  type ServiceIdentity,
} from '../lib/auth/service-tokens.js';

export const internalRouter = labeledRouter('public');

const RATE_KEY_PREFIX = 'svc-token-issue:';
const issuanceCounters = new Map<string, number[]>(); // bootstrapId -> timestamps

function checkIssueRate(bootstrapId: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  let bucket = issuanceCounters.get(bootstrapId);
  if (!bucket) {
    bucket = [];
    issuanceCounters.set(bootstrapId, bucket);
  }
  while (bucket.length > 0 && now - bucket[0] >= windowMs) bucket.shift();
  if (bucket.length >= 12) return false;
  bucket.push(now);
  return true;
}

internalRouter.post('/issue-token', async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({
      error: { code: 'unauthenticated', message: 'Bootstrap secret required in Authorization: Bearer header' },
    });
    return;
  }
  const secret = header.slice(7).trim();

  const body = req.body as { service?: string };
  const service = body.service as ServiceIdentity;
  if (!service || !['worker', 'scheduler', 'module-runner'].includes(service)) {
    throw new ValidationError('service must be one of worker, scheduler, module-runner');
  }

  const validation = validateBootstrapSecret(secret, service);
  if (!validation.ok) {
    res.status(validation.reason === 'unknown' ? 401 : 403).json({
      error: {
        code: validation.reason === 'unknown' ? 'unauthenticated' : 'forbidden',
        message: validation.reason === 'unknown' ? 'Invalid bootstrap secret' : 'Bootstrap secret not authorised for this service',
      },
    });
    return;
  }

  if (!checkIssueRate(validation.bootstrapId)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({
      error: { code: 'rate_limited', message: 'Too many token issues from this bootstrap secret' },
    });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;
  const issued = await mintToken(service, validation.bootstrapId, ip);
  res.status(200).json(issued);
});

void RATE_KEY_PREFIX; // reserved for follow-up Redis-backed limiter.
