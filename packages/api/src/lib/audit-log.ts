/**
 * Audit logging utility.
 * Writes to the audit_log table for module operations.
 * Failures are non-blocking (operations continue on write failure).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { redactSensitive } from './log-redaction';

export interface AuditEntry {
  action: string;
  targetModuleId?: string;
  targetSourceId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write an audit log entry. Non-blocking: if the write fails,
 * logs an error but does NOT throw or block the calling operation.
 */
export async function writeAuditLog(
  supabase: SupabaseClient,
  actorUserId: string | undefined,
  actorRole: string | undefined,
  entry: AuditEntry,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('audit_log')
      .insert({
        actor_user_id: actorUserId ?? null,
        actor_role: actorRole ?? null,
        action: entry.action,
        target_module_id: entry.targetModuleId ?? null,
        target_source_id: entry.targetSourceId ?? null,
        request_id: entry.requestId ?? null,
        metadata: entry.metadata ? redactSensitive(entry.metadata) as Record<string, unknown> : null,
      });

    if (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'AUDIT_LOG_WRITE_FAILED',
        request_id: entry.requestId,
        action: entry.action,
        target_module_id: entry.targetModuleId,
        error: error.message,
        ts: new Date().toISOString(),
      }));
    }
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'AUDIT_LOG_WRITE_FAILED',
      request_id: entry.requestId,
      action: entry.action,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
}
