/**
 * Standard error envelope per spec-production-readiness-hardening §5.13.
 *
 * Every API response with status >= 400 returns:
 *
 *   { "error": { "code": "...", "message": "...", "request_id": "..." } }
 *
 * `code` is from a fixed enum (machine-readable). `message` may be
 * shown to end users. `request_id` matches the x-request-id header
 * for log correlation.
 *
 * Throw an instance of {@link ApiError} from any route or middleware;
 * the `errorEnvelope` middleware catches it and serialises the
 * envelope. Custom subclasses below cover the common cases.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

export type ApiErrorCode =
  | 'unauthenticated'
  | 'token_expired'
  | 'invalid_token'
  | 'forbidden'
  | 'no_account'
  | 'not_found'
  | 'validation_failed'
  | 'rate_limited'
  | 'conflict'
  | 'tenant_isolation_violation'
  | 'internal_error';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(message = 'Authentication required') {
    super(401, 'unauthenticated', message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found') {
    super(404, 'not_found', message);
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'validation_failed', message, details);
  }
}

export class RateLimitedError extends ApiError {
  constructor(message: string, retryAfterSeconds?: number) {
    super(429, 'rate_limited', message, retryAfterSeconds ? { retry_after: retryAfterSeconds } : undefined);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

/**
 * Express error-handling middleware. Mount last (after all routes).
 * Converts ApiError instances into the standard envelope; falls
 * through to a 500 internal_error envelope for any other thrown
 * value (with the original error logged via Pino so it can be
 * correlated with Sentry).
 */
export function errorEnvelope(
  err: unknown,
  req: Request,
  res: Response,
  // The fourth param is required for Express to recognise this as an
  // error handler — the `_next` underscore prefix matches eslint's
  // argsIgnorePattern, so no disable is needed.
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? (req as unknown as { id?: string }).id ?? '';

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        request_id: requestId,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  const e = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: e, requestId, url: req.url, method: req.method }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Internal server error',
      request_id: requestId,
    },
  });
}
