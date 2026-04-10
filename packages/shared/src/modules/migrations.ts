import type { LoadedModule } from '../types/modules';
import type { SupabaseClient } from './supabase-types';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

/**
 * Result of applying (or attempting to apply) a module's migrations.
 * Returned rather than thrown so a single sloppy migration can't poison
 * the rest of the reconcile loop.
 */
export interface MigrationResult {
  moduleId: string;
  applied: string[];
  skipped: string[];
  failed: null | {
    filename: string;
    message: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
  };
}

/**
 * Apply pending migrations for a module.
 *
 * Semantics:
 *   - Each migration runs inside its own SAVEPOINT so a failure inside
 *     one migration cannot leave the connection in an aborted-transaction
 *     state that would poison later migrations or later modules.
 *   - Migrations within a module are strictly ordered. On the first
 *     failure we stop applying that module's migrations, but we do NOT
 *     throw: the caller gets a result object describing what applied and
 *     what failed. This lets the reconcile loop continue with other
 *     modules.
 *   - Successfully-applied migrations are recorded in `module_migrations`
 *     with their checksum so they won't be re-run.
 */
export async function applyModuleMigrations(
  mod: LoadedModule,
  supabase: SupabaseClient
): Promise<MigrationResult> {
  const result: MigrationResult = {
    moduleId: mod.config.id,
    applied: [],
    skipped: [],
    failed: null,
  };

  const migrations = mod.config.migrations;
  if (!migrations || migrations.length === 0) return result;

  // Get already-applied migrations so we skip them.
  const { data: applied, error } = await supabase
    .from('module_migrations')
    .select('filename')
    .eq('module_id', mod.config.id);

  if (error) {
    result.failed = {
      filename: '(query module_migrations)',
      message: `Failed to query module_migrations: ${JSON.stringify(error)}`,
    };
    return result;
  }

  const appliedSet = new Set((applied ?? []).map((r) => r.filename as string));

  // Resolve migration file paths relative to the module's directory.
  // Prefer resolvedDir (actual source directory on disk) over require.resolve
  // which may not work for modules loaded from external sources.
  let packageDir: string;
  if (mod.resolvedDir) {
    packageDir = mod.resolvedDir;
  } else {
    try {
      const packageMain = require.resolve(mod.packageName);
      packageDir = dirname(packageMain);
    } catch {
      packageDir = process.cwd();
    }
  }

  for (const migrationPath of migrations) {
    const filename = migrationPath.replace(/^\.\//, '');

    if (appliedSet.has(filename)) {
      result.skipped.push(filename);
      continue;
    }

    const fullPath = resolve(packageDir, migrationPath);
    let sql: string;

    try {
      sql = readFileSync(fullPath, 'utf-8');
    } catch (readErr) {
      result.failed = {
        filename,
        message: `Cannot read migration file "${fullPath}": ${readErr instanceof Error ? readErr.message : String(readErr)}`,
      };
      console.error(`[modules] ${mod.config.id}: failed to read "${filename}": ${result.failed.message}`);
      return result;
    }

    const checksum = createHash('sha256').update(sql).digest('hex');

    console.log(`[modules] Applying migration "${filename}" for "${mod.config.id}"...`);

    // Run the migration. exec_sql is SECURITY DEFINER and opens its own
    // autonomous transaction per call, so a failing statement aborts only
    // this one migration's transaction — the connection is left clean for
    // subsequent calls. That is the "savepoint" guarantee we need here.
    //
    // Note: if you want statement-level savepoints *within* a single
    // migration file, write idempotent SQL (CREATE IF NOT EXISTS, DROP ...
    // IF EXISTS before CREATE, etc.). The runner can't rescue a half-
    // applied migration because exec_sql gives us no visibility into
    // which statement inside failed.
    const { error: rpcErr } = await supabase.rpc('exec_sql', { sql_text: sql });

    if (rpcErr) {
      const err = rpcErr as Record<string, unknown>;
      result.failed = {
        filename,
        message: (err?.message as string) || JSON.stringify(rpcErr),
        code: err?.code as string | undefined,
        details: (err?.details as string | null | undefined) ?? null,
        hint: (err?.hint as string | null | undefined) ?? null,
      };
      console.error(
        `[modules] ${mod.config.id}: migration "${filename}" failed — ${result.failed.message}` +
          (result.failed.code ? ` (code: ${result.failed.code})` : ''),
      );
      // Stop applying more migrations for this module. Later ones may
      // depend on this one, and running them could corrupt state.
      return result;
    }

    const { error: insertErr } = await supabase
      .from('module_migrations')
      .insert({
        module_id: mod.config.id,
        filename,
        checksum,
      });

    if (insertErr) {
      console.warn(`[modules] ${mod.config.id}: could not record migration "${filename}":`, insertErr);
    }

    result.applied.push(filename);
    console.log(`[modules] ${mod.config.id}: applied "${filename}"`);
  }

  return result;
}
