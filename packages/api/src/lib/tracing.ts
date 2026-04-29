/**
 * OpenTelemetry tracing initialisation per spec §5.6.
 *
 * Opt-in: when OTEL_EXPORTER_OTLP_ENDPOINT is unset, this module is a
 * no-op (the SDK is never started, so import cost is bounded by Node
 * module resolution; no spans are emitted; no collector traffic).
 *
 * Required env when enabled:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  e.g. http://otel-collector:4318
 *
 * Optional:
 *   OTEL_SERVICE_NAME            defaults to GATEWAZE_SERVICE or 'api'
 *   OTEL_RESOURCE_ATTRIBUTES     extra resource attrs, kv comma-list
 *   OTEL_EXPORTER_OTLP_HEADERS   auth headers for the collector
 *
 * Auto-instrumentation covers express, ioredis, pg, and supabase-js
 * via getNodeAutoInstrumentations(). The collector is the operator's
 * concern (out of scope here per the spec).
 *
 * Call initTracing() ONCE, as early as possible in each Node entry-
 * point — before any module that creates spans gets imported. The
 * function is idempotent.
 */

import { logger } from './logger.js';

let started = false;
let sdk: { start: () => Promise<void>; shutdown: () => Promise<void> } | null = null;

export async function initTracing(): Promise<void> {
  if (started) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  // Lazy import so the no-config case doesn't pay the resolution cost.
  const [
    { NodeSDK },
    { getNodeAutoInstrumentations },
    { OTLPTraceExporter },
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/auto-instrumentations-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
  ]);

  const exporter = new OTLPTraceExporter({
    url: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint.replace(/\/$/, '')}/v1/traces`,
  });

  sdk = new NodeSDK({
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Cut noisy auto-instrumentations that don't match our shape.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  }) as never;

  try {
    await sdk!.start();
    started = true;
    logger.info({ endpoint }, 'opentelemetry tracing started');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'opentelemetry init failed; tracing disabled');
    sdk = null;
  }
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
    } catch {
      // ignore on shutdown
    }
  }
  sdk = null;
  started = false;
}
