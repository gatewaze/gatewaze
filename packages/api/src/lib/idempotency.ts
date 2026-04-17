/**
 * Idempotency middleware for module API endpoints.
 * Requires Idempotency-Key header (UUID v4) on all mutating requests.
 * Uses INSERT ... ON CONFLICT for atomic key claiming.
 */

import type { Request, Response, NextFunction } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_SIZE = 256 * 1024; // 256 KB
const EXPIRY_HOURS = 24;

export interface IdempotencyOptions {
  /** Route template for scoping, e.g. '/api/modules/{moduleId}/enable' */
  routeTemplate: string;
  /** Resource key extractor, e.g. req => `module:${req.params.moduleId}` */
  resourceKey?: (req: Request) => string;
}

/**
 * Create idempotency middleware for a specific route.
 */
export function idempotencyMiddleware(
  getSupabase: () => SupabaseClient,
  options: IdempotencyOptions,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'] as string | undefined;

    if (!key || !UUID_V4_REGEX.test(key)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid or missing Idempotency-Key header (must be UUID v4)',
          details: { header: 'Idempotency-Key' },
        },
      });
    }

    const actorUserId = (req as any).userId ?? '00000000-0000-0000-0000-000000000000';
    const route = options.routeTemplate;
    const resourceKey = options.resourceKey?.(req) ?? 'global';

    // Hash the request body for comparison
    const bodyStr = JSON.stringify(req.body ?? {});
    const requestHash = createHash('sha256').update(bodyStr).digest('hex');

    const supabase = getSupabase();

    // Atomic claim using INSERT ... ON CONFLICT
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

    const { data: inserted, error: insertErr } = await supabase
      .from('idempotency_keys')
      .insert({
        idempotency_key: key,
        actor_user_id: actorUserId,
        route,
        resource_key: resourceKey,
        request_hash: requestHash,
        response_json: {},
        status_code: 0,
        in_progress: true,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (insertErr) {
      // Key already exists — check if it's a replay or in-progress
      const { data: existing } = await supabase
        .from('idempotency_keys')
        .select('*')
        .eq('idempotency_key', key)
        .eq('actor_user_id', actorUserId)
        .eq('route', route)
        .eq('resource_key', resourceKey)
        .single();

      if (existing) {
        const row = existing as any;

        if (row.in_progress) {
          return res.status(409).json({
            error: {
              code: 'IDEMPOTENCY_IN_PROGRESS',
              message: 'A request with this idempotency key is currently in progress',
              details: {},
            },
          });
        }

        if (row.request_hash !== requestHash) {
          return res.status(409).json({
            error: {
              code: 'IDEMPOTENCY_KEY_REUSE',
              message: 'Idempotency key was used with a different request body',
              details: {},
            },
          });
        }

        // Replay stored response
        res.setHeader('X-Idempotency-Replay', 'true');
        return res.status(row.status_code).json(row.response_json);
      }

      // Some other error
      return next();
    }

    // We claimed the key — proceed with the request
    // Capture the response to store it
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      // Store the response (fire-and-forget)
      const responseJson = JSON.stringify(body).length > MAX_RESPONSE_SIZE
        ? { truncated: true, code: res.statusCode }
        : body;

      supabase
        .from('idempotency_keys')
        .update({
          response_json: responseJson,
          status_code: res.statusCode,
          in_progress: false,
        })
        .eq('idempotency_key', key)
        .eq('actor_user_id', actorUserId)
        .eq('route', route)
        .eq('resource_key', resourceKey)
        .then(() => {});

      return originalJson(body);
    };

    next();
  };
}
