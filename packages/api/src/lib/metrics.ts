/**
 * Prometheus-compatible metrics for the module subsystem.
 *
 * Exposes a simple text-based Prometheus metrics endpoint.
 * Uses in-process counters (single-replica v1.1 constraint).
 *
 * Metrics endpoint: GET /metrics on a separate internal port (9464).
 * Not routed through Traefik. No authentication (relies on network isolation).
 */

// Simple counter/histogram implementation (no prom-client dependency needed for v1.1)

interface CounterEntry {
  labels: Record<string, string>;
  value: number;
}

interface HistogramEntry {
  labels: Record<string, string>;
  sum: number;
  count: number;
  buckets: Map<number, number>;
}

const counters = new Map<string, CounterEntry[]>();
const histograms = new Map<string, HistogramEntry[]>();

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

// ============================================================================
// Counter helpers
// ============================================================================

function findOrCreateCounter(name: string, labels: Record<string, string>): CounterEntry {
  let entries = counters.get(name);
  if (!entries) {
    entries = [];
    counters.set(name, entries);
  }

  const existing = entries.find((e) =>
    Object.keys(labels).every((k) => e.labels[k] === labels[k]) &&
    Object.keys(e.labels).length === Object.keys(labels).length,
  );
  if (existing) return existing;

  const entry: CounterEntry = { labels, value: 0 };
  entries.push(entry);
  return entry;
}

function findOrCreateHistogram(name: string, labels: Record<string, string>): HistogramEntry {
  let entries = histograms.get(name);
  if (!entries) {
    entries = [];
    histograms.set(name, entries);
  }

  const existing = entries.find((e) =>
    Object.keys(labels).every((k) => e.labels[k] === labels[k]) &&
    Object.keys(e.labels).length === Object.keys(labels).length,
  );
  if (existing) return existing;

  const buckets = new Map<number, number>();
  for (const b of DEFAULT_BUCKETS) buckets.set(b, 0);

  const entry: HistogramEntry = { labels, sum: 0, count: 0, buckets };
  entries.push(entry);
  return entry;
}

// ============================================================================
// Public API
// ============================================================================

/** Increment a counter metric */
export function incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
  const entry = findOrCreateCounter(name, labels);
  entry.value += value;
}

/** Observe a histogram value (e.g., duration in ms) */
export function observeHistogram(name: string, labels: Record<string, string>, value: number): void {
  const entry = findOrCreateHistogram(name, labels);
  entry.sum += value;
  entry.count += 1;
  for (const [bucket] of entry.buckets) {
    if (value <= bucket) {
      entry.buckets.set(bucket, (entry.buckets.get(bucket) ?? 0) + 1);
    }
  }
}

// ============================================================================
// Pre-defined metrics (convenience wrappers)
// ============================================================================

export function recordReconcileDuration(durationMs: number, result: 'ok' | 'failed'): void {
  observeHistogram('gatewaze_modules_reconcile_duration_ms', { result }, durationMs);
}

export function recordMigration(moduleId: string, result: 'applied' | 'skipped' | 'failed'): void {
  incrementCounter('gatewaze_module_migrations_total', { module_id: moduleId, result });
}

export function recordEdgeDeploy(moduleId: string, strategy: string, result: 'deployed' | 'skipped' | 'failed'): void {
  incrementCounter('gatewaze_edge_deploy_total', { module_id: moduleId, strategy, result });
}

export function recordUploadRejected(reason: string): void {
  incrementCounter('gatewaze_module_upload_rejected_total', { reason });
}

export function recordAuditWriteFailure(reason: string): void {
  incrementCounter('gatewaze_audit_log_write_failures_total', { reason });
}

// ============================================================================
// Prometheus text format serializer
// ============================================================================

function formatLabels(labels: Record<string, string>): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`);
  return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

/** Generate Prometheus text exposition format */
export function serializeMetrics(): string {
  const lines: string[] = [];

  // Counters
  for (const [name, entries] of counters) {
    lines.push(`# TYPE ${name} counter`);
    for (const entry of entries) {
      lines.push(`${name}${formatLabels(entry.labels)} ${entry.value}`);
    }
  }

  // Histograms
  for (const [name, entries] of histograms) {
    lines.push(`# TYPE ${name} histogram`);
    for (const entry of entries) {
      const lblStr = formatLabels(entry.labels);
      for (const [bucket, count] of [...entry.buckets].sort((a, b) => a[0] - b[0])) {
        const bucketLabels = { ...entry.labels, le: String(bucket) };
        lines.push(`${name}_bucket${formatLabels(bucketLabels)} ${count}`);
      }
      const infLabels = { ...entry.labels, le: '+Inf' };
      lines.push(`${name}_bucket${formatLabels(infLabels)} ${entry.count}`);
      lines.push(`${name}_sum${lblStr} ${entry.sum}`);
      lines.push(`${name}_count${lblStr} ${entry.count}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Start a metrics HTTP server on an internal port.
 * Separate from the main Express server for security (no auth, network-isolated).
 */
export function startMetricsServer(port: number = 9464): void {
  const { createServer } = require('http') as typeof import('http');

  const server = createServer((req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(serializeMetrics());
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(JSON.stringify({
      level: 'info',
      message: `Metrics server listening on 127.0.0.1:${port}/metrics`,
      ts: new Date().toISOString(),
    }));
  });
}
