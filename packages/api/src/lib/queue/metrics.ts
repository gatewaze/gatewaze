import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const brand = process.env.BRAND ?? 'default';
registry.setDefaultLabels({ brand });

export const jobDurationSeconds = new Histogram({
  name: 'gatewaze_job_duration_seconds',
  help: 'Job execution duration in seconds',
  labelNames: ['queue', 'name', 'status', 'module'],
  buckets: [0.1, 0.5, 1, 5, 30, 120, 600],
  registers: [registry],
});

export const jobTerminalFailuresTotal = new Counter({
  name: 'gatewaze_job_terminal_failures_total',
  help: 'Jobs that reached max attempts and moved to the failed set',
  labelNames: ['queue', 'name', 'module'],
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: 'gatewaze_queue_depth',
  help: 'Current depth of the queue per state',
  labelNames: ['queue', 'state', 'module'],
  registers: [registry],
});

export const queueHealthGauge = new Gauge({
  name: 'gatewaze_queue_health',
  help: '1 if Redis PING ok, 0 otherwise',
  labelNames: ['queue'],
  registers: [registry],
});

export const jobEnqueuedTotal = new Counter({
  name: 'gatewaze_job_enqueued_total',
  help: 'Jobs enqueued',
  labelNames: ['queue', 'name', 'module'],
  registers: [registry],
});

/**
 * Express middleware exposing /metrics. Mount explicitly by the process
 * that wants to expose metrics (API mounts it at /metrics; worker exposes
 * on its own port via `startMetricsServer`).
 */
export async function metricsHandler(_req: unknown, res: {
  setHeader: (k: string, v: string) => void;
  end: (body: string) => void;
  status?: (code: number) => unknown;
}): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}

/**
 * Start a standalone HTTP server on `port` that serves /metrics.
 * Used by the worker and scheduler processes, which don't otherwise run
 * Express.
 */
export function startMetricsServer(port: number): { close: () => Promise<void> } {
  // Lazy-require http to keep the hot path (API) free of the server import.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http') as typeof import('http');
  const server = http.createServer((req, res) => {
    if (req.url === '/metrics') {
      metricsHandler(req, {
        setHeader: (k, v) => res.setHeader(k, v),
        end: (body) => res.end(body),
      });
    } else if (req.url === '/ready') {
      const ready = readyState.ready;
      res.statusCode = ready ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ready, reason: readyState.reason }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(port);
  return {
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export const readyState: { ready: boolean; reason: string } = {
  ready: false,
  reason: 'starting',
};

export function markReady(): void {
  readyState.ready = true;
  readyState.reason = 'ready';
}
export function markNotReady(reason: string): void {
  readyState.ready = false;
  readyState.reason = reason;
}
