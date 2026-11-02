import { sanitizeMessage } from './sanitize';

export type TelemetrySink = (event: { name: string; [key: string]: unknown }) => void;

/**
 * Wraps the host's telemetry sink (or falls back to console.warn when the
 * host doesn't supply one). The embed never imports a host logging
 * singleton — this is the only channel it emits through. `detail`, if a
 * string, is run through sanitizeMessage() before being attached, so a
 * raw error message or URL never reaches the host's telemetry pipeline
 * unsanitized.
 */
export function createTelemetry(sink: TelemetrySink | undefined) {
  return function emit(name: string, fields: Record<string, unknown> = {}): void {
    const sanitizedFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      sanitizedFields[key] = typeof value === 'string' ? sanitizeMessage(value) : value;
    }
    const event = { name, ...sanitizedFields };
    if (sink) {
      try {
        sink(event);
      } catch {
        // Host telemetry sink threw — never let that take down the embed.
        console.warn('[gw-embed] telemetry sink threw', event);
      }
    } else {
      console.warn('[gw-embed]', event);
    }
  };
}
