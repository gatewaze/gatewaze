import type { Request, Response, NextFunction } from 'express';

/**
 * Send a canonical public API error response.
 *
 * All public API errors share the envelope:
 * ```json
 * { "error": { "code": "...", "message": "...", "details": {...} } }
 * ```
 */
export function sendPublicApiError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  const body: { error: { code: string; message: string; details?: Record<string, unknown> } } = {
    error: { code, message },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  res.status(statusCode).json(body);
}

/**
 * Catch-all error handler middleware for the public API router.
 *
 * Converts thrown errors into the canonical error envelope. Handles:
 * - Structured error objects with `statusCode`, `code`, and `message`
 *   (e.g. those thrown by `parsePagination`)
 * - SyntaxError from malformed JSON bodies
 * - Generic Error instances
 * - Unknown throw values
 */
export function publicApiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Structured error thrown by our helpers (e.g. parsePagination)
  if (
    err !== null &&
    typeof err === 'object' &&
    'statusCode' in err &&
    'code' in err &&
    'message' in err
  ) {
    const structured = err as { statusCode: number; code: string; message: string; details?: Record<string, unknown> };
    sendPublicApiError(res, structured.statusCode, structured.code, structured.message, structured.details);
    return;
  }

  // JSON parse errors from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    sendPublicApiError(res, 400, 'INVALID_JSON', 'The request body contains invalid JSON.');
    return;
  }

  // Standard Error instances
  if (err instanceof Error) {
    console.error('[public-api] Unhandled error:', err);
    sendPublicApiError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    return;
  }

  // Totally unknown throw value
  console.error('[public-api] Unknown error:', err);
  sendPublicApiError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}
