/**
 * HTTP RED metrics (Rate, Errors, Duration) middleware for Express
 * per spec-production-readiness-hardening §5.6 / §5.14.
 *
 * Labels: route, method, status, account_id (cardinality bounded by
 * the platform's account count), brand. The `account_id` label
 * enables per-tenant performance monitoring; route is the matched
 * Express route pattern (e.g. `/api/people/:id`), not the raw URL,
 * so cardinality stays bounded.
 *
 * Uses the existing process-wide prom-client registry from
 * `lib/queue/metrics.ts` so all metrics surface on a single
 * `/metrics` endpoint.
 */

import type { Request, Response, NextFunction } from 'express';
import { Counter, Histogram, Registry } from 'prom-client';

let httpRequestsTotal: Counter<string> | null = null;
let httpRequestDurationSeconds: Histogram<string> | null = null;

export function initRedMetrics(register: Registry): void {
  if (httpRequestsTotal) return;
  httpRequestsTotal = new Counter({
    name: 'gatewaze_http_requests_total',
    help: 'Count of HTTP requests handled by the API.',
    labelNames: ['method', 'route', 'status', 'account_id', 'brand'],
    registers: [register],
  });
  httpRequestDurationSeconds = new Histogram({
    name: 'gatewaze_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status', 'account_id', 'brand'],
    // Roughly one bucket per order of magnitude up to 10s.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
  });
}

const BRAND = process.env.BRAND ?? 'default';

export function redMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!httpRequestsTotal || !httpRequestDurationSeconds) {
    next();
    return;
  }
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (!httpRequestsTotal || !httpRequestDurationSeconds) return;
    const elapsedSec = Number(process.hrtime.bigint() - start) / 1e9;
    // Express sets req.route on matched routes. Fall back to req.path
    // for unmatched (which would 404). req.route.path is the pattern
    // (e.g. "/:id"); we prefix with the matched mount path for clarity.
    const routeLabel = (req as unknown as { route?: { path?: string } }).route?.path
      ?? req.baseUrl
      ?? 'unknown';
    const labels = {
      method: req.method,
      route: req.baseUrl ? `${req.baseUrl}${routeLabel === '/' ? '' : routeLabel}` : routeLabel,
      status: String(res.statusCode),
      account_id: req.accountId ?? 'none',
      brand: BRAND,
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, elapsedSec);
  });
  next();
}
