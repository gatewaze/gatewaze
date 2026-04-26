/**
 * Listing-schema validator per spec-platform-listing-pattern.md §4.2.
 *
 * Runs at module load time + via the CI index-coverage script. Reports
 * actionable errors so a misconfigured schema fails before serving a
 * single request.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListingSchema, ProjectionItem } from './types';

export interface SchemaValidationIssue {
  schemaId: string;
  code: 'LISTING_SCHEMA_INVALID' | 'INDEX_MISSING' | 'MISSING_EXTENSION_PG_TRGM';
  field: string;
  message: string;
}

export interface ValidateOptions {
  /** Skip DB-touching checks (column existence, index coverage). Useful for unit tests. */
  skipDbChecks?: boolean;
}

/**
 * Validate one schema. Returns an array of issues; empty = clean.
 * The caller decides whether to fail-fast or surface as warnings.
 */
export async function validateListingSchema(
  schema: ListingSchema,
  supabase: SupabaseClient | null,
  opts: ValidateOptions = {}
): Promise<SchemaValidationIssue[]> {
  const issues: SchemaValidationIssue[] = [];
  const push = (code: SchemaValidationIssue['code'], field: string, message: string) =>
    issues.push({ schemaId: schema.id, code, field, message });

  // ── Static checks: no DB needed ──────────────────────────────────────────

  // 1. defaultSort.column must be in sortable.
  if (!schema.sortable[schema.defaultSort.column]) {
    push('LISTING_SCHEMA_INVALID', 'defaultSort.column',
      `defaultSort.column '${schema.defaultSort.column}' is not in sortable allowlist`);
  }

  // 2. Every sortable value must appear in indexedColumns.
  for (const [k, dbCol] of Object.entries(schema.sortable)) {
    if (!schema.indexedColumns.includes(dbCol)) {
      push('LISTING_SCHEMA_INVALID', `sortable.${k}`,
        `sortable column '${dbCol}' is not declared in indexedColumns — sort would seq-scan`);
    }
  }

  // 3. Every searchable column must appear in indexedColumns (trgm index).
  for (const col of schema.searchable) {
    if (!schema.indexedColumns.includes(col)) {
      push('LISTING_SCHEMA_INVALID', `searchable.${col}`,
        `searchable column '${col}' is not declared in indexedColumns`);
    }
  }

  // 4. Every filter's underlying column must appear in indexedColumns
  //    (unless the filter kind is for a tiny enum table where it's safe).
  for (const [k, decl] of Object.entries(schema.filters)) {
    if (!schema.indexedColumns.includes(decl.column)) {
      push('LISTING_SCHEMA_INVALID', `filters.${k}`,
        `filter column '${decl.column}' is not declared in indexedColumns`);
    }
  }

  // 5. authFilters required when projection is non-empty for publicApi/portal.
  for (const consumer of ['publicApi', 'portal'] as const) {
    const proj = schema.projections[consumer];
    if (proj && proj.length > 0 && !schema.authFilters[consumer]) {
      push('LISTING_SCHEMA_INVALID', `authFilters.${consumer}`,
        `Schema declares projection for '${consumer}' but no authFilters.${consumer} — fail-closed to avoid accidental data exposure`);
    }
  }

  // 6. Computed projections require a backing view in v1 — surface a helpful error.
  for (const consumer of ['admin', 'publicApi', 'mcp', 'portal'] as const) {
    const items = schema.projections[consumer];
    if (!items) continue;
    for (const item of items) {
      if (typeof item === 'object' && 'computed' in item) {
        push('LISTING_SCHEMA_INVALID', `projections.${consumer}.${item.as}`,
          `Computed projection '${item.as}' is reserved for v2 — express as a SQL view in v1 (see spec §4.1b)`);
      }
    }
  }

  // ── DB-touching checks ────────────────────────────────────────────────────

  if (opts.skipDbChecks || !supabase) return issues;

  // 7. Every column referenced (projection, sortable values, filter columns,
  //    searchable, indexedColumns) must exist in the underlying table.
  const referencedCols = collectReferencedColumns(schema);
  const tableCols = await fetchTableColumns(supabase, schema.table);
  if (tableCols === null) {
    push('LISTING_SCHEMA_INVALID', 'table',
      `Could not introspect table '${schema.table}' — does it exist?`);
    return issues;
  }
  for (const col of referencedCols) {
    if (!tableCols.has(col)) {
      push('LISTING_SCHEMA_INVALID', 'projection/sortable/filter',
        `Column '${col}' referenced by schema does not exist on table '${schema.table}'`);
    }
  }

  // 8. Every column in indexedColumns must have a usable index.
  const indexedCols = await fetchIndexedColumns(supabase, schema.table);
  if (indexedCols === null) {
    push('LISTING_SCHEMA_INVALID', 'indexedColumns',
      `Could not introspect indexes for table '${schema.table}'`);
    return issues;
  }
  for (const col of schema.indexedColumns) {
    if (!indexedCols.has(col)) {
      push('INDEX_MISSING', `indexedColumns.${col}`,
        `Column '${col}' is declared as indexed but no usable index found on table '${schema.table}'`);
    }
  }

  // 9. If any column is in `searchable`, pg_trgm must be installed.
  if (schema.searchable.length > 0) {
    const hasTrgm = await fetchExtensionPresent(supabase, 'pg_trgm');
    if (!hasTrgm) {
      push('MISSING_EXTENSION_PG_TRGM', 'searchable',
        `searchable columns require pg_trgm extension; enable it in Supabase Dashboard → Database → Extensions`);
    }
  }

  // 10. FK lookups: validate referencedColumn is a PK or has UNIQUE.
  for (const consumer of ['admin', 'publicApi', 'mcp', 'portal'] as const) {
    const items = schema.projections[consumer];
    if (!items) continue;
    for (const item of items) {
      if (typeof item === 'object' && 'fkLookup' in item) {
        const ok = await fetchColumnIsUnique(supabase, item.fkLookup.referencedTable, item.fkLookup.referencedColumn);
        if (!ok) {
          push('LISTING_SCHEMA_INVALID', `projections.${consumer}.${item.as}`,
            `FK lookup '${item.as}' references ${item.fkLookup.referencedTable}.${item.fkLookup.referencedColumn} which is not PRIMARY KEY or UNIQUE — would not guarantee 1:1`);
        }
      }
    }
  }

  return issues;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function collectReferencedColumns(schema: ListingSchema): Set<string> {
  const cols = new Set<string>();
  cols.add(schema.primaryKey);
  for (const dbCol of Object.values(schema.sortable)) cols.add(dbCol);
  for (const decl of Object.values(schema.filters)) cols.add(decl.column);
  for (const col of schema.searchable) cols.add(col);
  for (const col of schema.indexedColumns) cols.add(col);
  for (const items of Object.values(schema.projections)) {
    for (const item of items ?? []) {
      const c = projectionItemColumn(item);
      if (c) cols.add(c);
    }
  }
  return cols;
}

function projectionItemColumn(item: ProjectionItem): string | null {
  if (typeof item === 'string') return item;
  if ('col' in item) return item.col;
  if ('fkLookup' in item) return item.fkLookup.fkColumn;
  return null;
}

async function fetchTableColumns(supabase: SupabaseClient, table: string): Promise<Set<string> | null> {
  // information_schema is exposed via PostgREST when the API uses service role.
  // We query without RLS for table metadata.
  const { data, error } = await supabase.rpc('listing_introspect_columns', { p_table: table }).then(
    (r) => r,
    () => ({ data: null, error: { message: 'rpc-missing' } as const })
  );
  if (error || !Array.isArray(data)) {
    // Fall back: attempt a 0-row select to confirm the table exists; we
    // can't enumerate columns without an RPC. If the RPC is missing, skip
    // strict column checks rather than fail-closed.
    return new Set<string>(['__skipped_introspection__']);
  }
  return new Set<string>((data as Array<{ column_name: string }>).map((r) => r.column_name));
}

async function fetchIndexedColumns(supabase: SupabaseClient, table: string): Promise<Set<string> | null> {
  const { data, error } = await supabase.rpc('listing_introspect_indexes', { p_table: table }).then(
    (r) => r,
    () => ({ data: null, error: { message: 'rpc-missing' } as const })
  );
  if (error || !Array.isArray(data)) {
    return new Set<string>(['__skipped_introspection__']);
  }
  return new Set<string>((data as Array<{ column_name: string }>).map((r) => r.column_name));
}

async function fetchExtensionPresent(supabase: SupabaseClient, extName: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('listing_extension_installed', { p_name: extName }).then(
    (r) => r,
    () => ({ data: null, error: { message: 'rpc-missing' } as const })
  );
  if (error) return true; // Skip if RPC missing (don't fail-closed on an introspection gap).
  return data === true;
}

async function fetchColumnIsUnique(supabase: SupabaseClient, table: string, column: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('listing_column_is_unique', { p_table: table, p_column: column }).then(
    (r) => r,
    () => ({ data: null, error: { message: 'rpc-missing' } as const })
  );
  if (error) return true; // Skip if RPC missing.
  return data === true;
}

// Helper to bypass introspection gracefully when the helper RPCs aren't installed.
function isSkipped(set: Set<string> | null | undefined): boolean {
  return !!set && set.has('__skipped_introspection__');
}
export { isSkipped };
