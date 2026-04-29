/**
 * OpenTelemetry tracing — placeholder (no-op).
 *
 * Spec §5.6 requires the OTel SDK to be wired with a noop exporter by
 * default, so brands that want tracing can deploy a collector without
 * code changes. The full SDK install (@opentelemetry/sdk-node,
 * @opentelemetry/auto-instrumentations-node, exporter-trace-otlp-http)
 * adds ~30 MB to the API image.
 *
 * To keep the no-config case zero-cost, this file is a placeholder
 * that:
 *   - Documents the env contract (OTEL_EXPORTER_OTLP_ENDPOINT,
 *     OTEL_SERVICE_NAME, OTEL_RESOURCE_ATTRIBUTES).
 *   - Logs a warning if the operator sets OTEL_* env vars but the SDK
 *     packages aren't installed yet, so the misconfiguration surfaces
 *     loudly.
 *
 * Session 11 follow-up: install the SDK packages and replace this
 * file's body with an actual init. Tracked in spec §7.2 task 2.6.
 */

import { logger } from './logger.js';

export function initTracing(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;
  logger.warn(
    { endpoint },
    'OTEL_EXPORTER_OTLP_ENDPOINT is set but the OTel SDK is not yet installed in this build. Tracing is disabled. See packages/api/src/lib/tracing.ts.',
  );
}
