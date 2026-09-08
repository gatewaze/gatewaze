/**
 * Shared sanitizer for anything that crosses the embed's onFatal/telemetry
 * boundary (spec definition-of-done: "telemetry events emitted with
 * URL/token sanitization"). Strips full URLs (query/fragment can carry a
 * Supabase access token or LFID state) and common bearer-token shapes,
 * then bounds the length so a runaway error message can't balloon a
 * telemetry payload.
 */
export function sanitizeMessage(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input ?? '');
  const stripped = raw
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(bearer|token|access_token|refresh_token)[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 0 ? stripped.slice(0, 300) : 'Unknown error';
}
