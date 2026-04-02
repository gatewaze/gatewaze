import type { LoadedModule } from '../types/modules';
import type { SupabaseClient } from './supabase-types';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

/**
 * Apply pending migrations for a module.
 *
 * Reads SQL files from the module's `migrations` array, checks which have
 * already been applied (via module_migrations table), and executes new ones
 * in order.
 */
export async function applyModuleMigrations(
  mod: LoadedModule,
  supabase: SupabaseClient
): Promise<void> {
  const migrations = mod.config.migrations;
  if (!migrations || migrations.length === 0) return;

  // Get already-applied migrations
  const { data: applied, error } = await supabase
    .from('module_migrations')
    .select('filename')
    .eq('module_id', mod.config.id);

  if (error) {
    throw new Error(`Failed to query module_migrations for "${mod.config.id}": ${JSON.stringify(error)}`);
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
      continue;
    }

    const fullPath = resolve(packageDir, migrationPath);
    let sql: string;

    try {
      sql = readFileSync(fullPath, 'utf-8');
    } catch (readErr) {
      throw new Error(
        `Cannot read migration file "${fullPath}" for module "${mod.config.id}": ${readErr}`
      );
    }

    const checksum = createHash('sha256').update(sql).digest('hex');

    console.log(`[modules] Applying migration "${filename}" for "${mod.config.id}"...`);

    const { error: rpcErr } = await supabase.rpc('exec_sql', { sql_text: sql });

    if (rpcErr) {
      throw new Error(
        `Migration "${filename}" failed for module "${mod.config.id}": ${JSON.stringify(rpcErr)}`
      );
    }

    const { error: insertErr } = await supabase
      .from('module_migrations')
      .insert({
        module_id: mod.config.id,
        filename,
        checksum,
      });

    if (insertErr) {
      console.warn(`[modules] Warning: could not record migration "${filename}":`, insertErr);
    }

    console.log(`[modules] Applied migration "${filename}"`);
  }
}
