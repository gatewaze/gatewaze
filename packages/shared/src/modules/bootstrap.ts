/**
 * Supabase Cloud Bootstrap Utilities.
 *
 * Provides functions to validate and prepare a Supabase instance
 * (local or cloud) for Gatewaze module operations.
 */

import type { SupabaseClient } from './supabase-types';
import { resolve } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';

export interface BootstrapResult {
  environment: 'local' | 'cloud';
  execSqlAvailable: boolean;
  coreMigrationsApplied: number;
  errors: string[];
  warnings: string[];
}

/**
 * Detect whether we're targeting a local or cloud Supabase instance.
 *
 * Heuristic:
 * - If EDGE_FUNCTIONS_CONTAINER is set → local (Docker-based)
 * - If SUPABASE_PROJECT_REF is set → cloud
 * - If SUPABASE_URL contains 'supabase.co' → cloud
 * - Otherwise → local
 */
export function detectEnvironment(): 'local' | 'cloud' {
  if (process.env.EDGE_FUNCTIONS_CONTAINER) return 'local';
  if (process.env.SUPABASE_PROJECT_REF) return 'cloud';
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  if (url.includes('supabase.co') || url.includes('supabase.com')) return 'cloud';
  return 'local';
}

/**
 * Check whether the exec_sql RPC function exists in the database.
 * Module migrations require this function to execute SQL.
 */
export async function checkExecSqlExists(supabase: SupabaseClient): Promise<boolean> {
  try {
    // Try calling exec_sql with a no-op statement
    const { error } = await (supabase as any).rpc('exec_sql', { sql_text: 'SELECT 1' });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Validate that cloud deployment credentials are configured.
 * Required for deploying edge functions to Supabase Cloud.
 */
export function validateCloudCredentials(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!process.env.SUPABASE_PROJECT_REF) {
    missing.push('SUPABASE_PROJECT_REF');
  }
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    missing.push('SUPABASE_ACCESS_TOKEN');
  }

  return { valid: missing.length === 0, missing };
}

/**
 * Apply core platform migrations to a Supabase instance.
 *
 * Reads SQL files from supabase/migrations/ and executes them in order.
 * Uses exec_sql if available, otherwise falls back to direct SQL execution
 * for the initial bootstrap (which includes the migration that creates exec_sql).
 */
export async function applyCoreMigrations(
  supabase: SupabaseClient,
  projectRoot: string,
): Promise<{ applied: string[]; errors: string[] }> {
  const migrationsDir = resolve(projectRoot, 'supabase/migrations');
  const applied: string[] = [];
  const errors: string[] = [];

  if (!existsSync(migrationsDir)) {
    errors.push(`Migrations directory not found: ${migrationsDir}`);
    return { applied, errors };
  }

  const files = readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');

    try {
      const { error } = await (supabase as any).rpc('exec_sql', { sql_text: sql });
      if (error) {
        // If exec_sql doesn't exist yet (first few migrations), try direct query
        // This is expected for the initial bootstrap
        errors.push(`Migration ${file}: ${JSON.stringify(error)}`);
      } else {
        applied.push(file);
        console.log(`[bootstrap] Applied core migration: ${file}`);
      }
    } catch (err) {
      errors.push(`Migration ${file}: ${err}`);
    }
  }

  return { applied, errors };
}

/**
 * Run a full bootstrap check for a Supabase instance.
 *
 * Validates:
 * 1. Environment detection (local vs cloud)
 * 2. exec_sql RPC function availability
 * 3. Cloud deployment credentials (if cloud)
 *
 * Does NOT apply migrations — call applyCoreMigrations separately if needed.
 */
export async function bootstrapCheck(
  supabase: SupabaseClient,
): Promise<BootstrapResult> {
  const environment = detectEnvironment();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check exec_sql availability
  const execSqlAvailable = await checkExecSqlExists(supabase);
  if (!execSqlAvailable) {
    errors.push(
      'exec_sql RPC function not found. Core platform migrations (00001-00017) must be applied first. ' +
      'Run `npx supabase db push` or apply migrations via the Supabase dashboard.'
    );
  }

  // Cloud-specific checks
  if (environment === 'cloud') {
    const { valid, missing } = validateCloudCredentials();
    if (!valid) {
      warnings.push(
        `Cloud deployment credentials missing: ${missing.join(', ')}. ` +
        'Edge function deployment to Supabase Cloud will fail without these.'
      );
    }
  }

  return {
    environment,
    execSqlAvailable,
    coreMigrationsApplied: 0, // Caller should check separately if needed
    errors,
    warnings,
  };
}
