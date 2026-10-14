/**
 * Application-wide Pino logger and request-id middleware.
 *
 * Consolidates the queue subsystem's logger pattern across the entire
 * API package. The redact list is the authoritative source for PII
 * paths per spec-production-readiness-hardening §5.15:
 *   - req.body.email / phone / tax_id
 *   - *.attendee.email / phone
 *   - *.recipient / *.to
 *
 * Usage:
 *
 *   import { logger } from './lib/logger.js'
 *   logger.info({ accountId }, 'event created')
 *
 * Per-request child loggers are produced by the requestLogger
 * middleware below; route handlers can read req.log to get a child
 * logger pre-bound with the request id.
 */

import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const brand = process.env.BRAND ?? 'default';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { brand, service: process.env.GATEWAZE_SERVICE ?? 'api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      // Pre-existing redactions (queue subsystem).
      'data.html',
      '*.password',
      '*.token',
      '*.secret',
      'req.headers.authorization',
      'req.headers.cookie',
      // PII fields per spec §5.15.
      'req.body.email',
      'req.body.phone',
      'req.body.tax_id',
      '*.attendee.email',
      '*.attendee.phone',
      '*.recipient',
      '*.to',
      // Sensitive cookie payload (session tokens).
      'res.headers["set-cookie"]',
      // Redirects can carry one-time codes, e.g. the MCP grant code.
      'res.headers.location',
    ],
    censor: '[REDACTED]',
  },
});

export type AppLogger = pino.Logger;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      log?: AppLogger;
    }
  }
}

/**
 * Express middleware that:
 *   1. Generates a UUID request id (or honours an inbound
 *      x-request-id / x-correlation-id header).
 *   2. Sets the X-Request-Id response header so clients can echo it
 *      back in bug reports.
 *   3. Binds a child logger with { requestId } onto req.log.
 *
 * pino-http wraps request/response logging on top — we use it for the
 * per-request log line emission and rely on its built-in genReqId
 * hook for header propagation.
 */
// Paths whose query string carries a one-time credential and must not be
// logged: GoTrue's ?code= on the MCP native LFID callback.
const QUERY_REDACTED_PREFIXES = ['/api/mcp-auth/lfid/callback/'];

/** The request URL for a log line, with the query replaced on those paths. */
export function logSafeUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const q = url.indexOf('?');
  if (q < 0) return url;
  const path = url.slice(0, q);
  // Express routing ignores case, so the match does too.
  const lower = path.toLowerCase();
  return QUERY_REDACTED_PREFIXES.some((p) => lower.startsWith(p)) ? `${path}?[REDACTED]` : url;
}

/**
 * pino-http request serializer. It receives pino's already-serialized request,
 * which also carries the parsed query, and redacts both on those paths.
 */
export function serializeRequestForLog<T extends { url?: string; query?: unknown }>(req: T): T {
  const url = logSafeUrl(req.url);
  return url === req.url ? req : { ...req, url, query: '[REDACTED]' };
}

export const requestLogger = pinoHttp({
  logger,
  serializers: { req: serializeRequestForLog },
  genReqId: (req, res) => {
    const inbound = (req.headers['x-request-id'] || req.headers['x-correlation-id']) as string | undefined;
    const id = inbound?.trim() || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${logSafeUrl(req.url)} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${logSafeUrl(req.url)} ${res.statusCode} ${err?.message ?? 'error'}`,
});

/**
 * Tiny shim that copies pino-http's id onto req.requestId for code
 * that wants the bare string. Mounted alongside requestLogger.
 */
export function attachRequestId(req: Request, _res: Response, next: NextFunction): void {
  // pino-http stores the id at req.id (set by genReqId).
  const id = (req as unknown as { id?: string }).id;
  if (id) req.requestId = id;
  next();
}
