/**
 * Shared helper for emitting integration events from core edge functions.
 *
 * Core functions call emitIntegrationEvent() instead of directly calling
 * third-party APIs (Customer.io, etc.). Integration modules consume these
 * events asynchronously from the integration_events table.
 *
 * All calls are fire-and-forget — they never block the core function's response.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type IntegrationEventType =
  | 'person.created'
  | 'person.updated'
  | 'person.enriched'
  | 'person.subscribed'
  | 'event.registered'

/**
 * Emit an integration event (fire-and-forget).
 * Never throws — errors are logged and swallowed.
 */
export function emitIntegrationEvent(
  supabase: SupabaseClient,
  eventType: IntegrationEventType,
  payload: Record<string, unknown>,
): void {
  supabase
    .from('integration_events')
    .insert({ event_type: eventType, payload })
    .then(({ error }) => {
      if (error) console.error(`[integration] Failed to emit ${eventType}:`, error.message)
    })
    .catch((err) => {
      console.error(`[integration] Failed to emit ${eventType}:`, err)
    })
}
