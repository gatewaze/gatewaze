/**
 * Shared listing-query primitive per spec-platform-listing-pattern.md §5.
 *
 * One pure-ish function: takes a schema + user query + auth context,
 * returns rows + count. Validates everything before touching the DB.
 * No string concat — every value is parameterised through the Supabase
 * query builder.
 */

import type {
  BuildListingQueryOpts,
  ListingResult,
  ListingSchema,
  ListingQuery,
  ListingQueryBuilder,
  ProjectionItem,
  ComputedExpr,
  FilterDeclaration,
  HandlerContext,
  SupabaseFilterFn,
} from './types';
import { ListingError } from './types';

const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 500;
const MIN_SEARCH_LENGTH = 3;
const MAX_SEARCH_LENGTH = 100;

/**
 * Build + execute the listing query.
 */
export async function buildListingQuery<Row = Record<string, unknown>>(
  opts: BuildListingQueryOpts
): Promise<ListingResult<Row>> {
  const { schema, consumer, query, ctx, supabase } = opts;

  // 1. Normalise + validate request shape.
  const page = validatePage(query.page);
  const pageSize = validatePageSize(query.pageSize);
  const sort = validateSort(schema, query.sort);
  const filters = validateFilters(schema, query.filters ?? {});
  const search = validateSearch(schema, query.search);

  // 2. Run the optional context enricher to populate ctx.extras.
  const enrichedCtx = await runEnricher(ctx, schema);

  // 3. Pick projection for this consumer + render to a Supabase select string.
  const projectionItems = schema.projections[consumer];
  if (!projectionItems || projectionItems.length === 0) {
    throw new ListingError(
      'LISTING_SCHEMA_INVALID',
      `Schema '${schema.id}' has no projection for consumer '${consumer}'`,
      { details: { consumer, schemaId: schema.id } }
    );
  }
  const selectString = renderProjection(projectionItems);

  // 4. Decide count strategy. Always start with `exact` so the UI
  //    reflects mutations (delete/insert) immediately. Falls back to
  //    `estimated` automatically on timeout (handled below).
  const initialCountStrategy: 'exact' = 'exact';

  // 5. Build the query.
  let qb = supabase.from(schema.table).select(selectString, { count: initialCountStrategy });

  // 6. Apply auth filter (if any) — runs before user filters so user can
  //    only further-narrow, never widen.
  const authFilterResolver = schema.authFilters[consumer];
  const authFn: SupabaseFilterFn | null = authFilterResolver ? authFilterResolver(enrichedCtx) : null;
  if (authFn) qb = authFn(qb) as unknown as typeof qb;

  // 7. Apply user filters via parameterised builders.
  qb = applyFilters(qb, schema, filters, enrichedCtx) as unknown as typeof qb;

  // 8. Apply search (ilike OR across searchable columns).
  if (search && schema.searchable.length > 0) {
    qb = applySearch(qb, schema, search) as unknown as typeof qb;
  }

  // 9. Apply sort + tie-break on primary key for stable pagination.
  const sortDbColumn = schema.sortable[sort.column];
  qb = qb.order(sortDbColumn, { ascending: sort.direction === 'asc' });
  if (sort.column !== schema.primaryKey) {
    qb = qb.order(schema.primaryKey, { ascending: true });
  }

  // 10. Apply page range.
  const from = page * pageSize;
  const to = from + pageSize - 1;
  qb = qb.range(from, to);

  // 11. Execute. On count timeout, retry the count with planner estimate.
  const { data, error, count } = await qb;
  if (error) {
    // Postgres 57014 = statement_timeout. Retry the count alone.
    if (initialCountStrategy === 'exact' && (error.code === '57014' || /timeout/i.test(error.message))) {
      return retryWithEstimatedCount<Row>(opts, { page, pageSize, sort, filters, search, projectionItems, authFn });
    }
    throw new ListingError('LISTING_INTERNAL_ERROR', error.message, { details: { code: error.code } });
  }

  return {
    rows: (data as Row[]) ?? [],
    page,
    pageSize,
    totalCount: count ?? 0,
    countStrategy: 'exact',
  };
}

/**
 * Count-only variant of buildListingQuery. Runs the same auth filter +
 * user filters + search but emits a `head: true, count: 'exact'` request
 * — no rows are fetched. Used by the portal's inactive-tab badge counts.
 *
 * Falls back to the planner-estimated count on statement timeout, just
 * like buildListingQuery.
 */
export async function buildListingCount(
  opts: BuildListingQueryOpts,
): Promise<{ count: number | null; countStrategy: 'exact' | 'estimated' | 'planned' }> {
  const { schema, consumer, query, ctx, supabase } = opts;

  const filters = validateFilters(schema, query.filters ?? {});
  const search = validateSearch(schema, query.search);

  const enrichedCtx = await runEnricher(ctx, schema);

  let qb = supabase.from(schema.table).select(schema.primaryKey, { count: 'exact', head: true });

  const authFilterResolver = schema.authFilters[consumer];
  const authFn: SupabaseFilterFn | null = authFilterResolver ? authFilterResolver(enrichedCtx) : null;
  if (authFn) qb = authFn(qb) as unknown as typeof qb;

  qb = applyFilters(qb, schema, filters, enrichedCtx) as unknown as typeof qb;
  if (search && schema.searchable.length > 0) {
    qb = applySearch(qb, schema, search) as unknown as typeof qb;
  }

  const { error, count } = await qb;
  if (error) {
    if (error.code === '57014' || /timeout/i.test(error.message)) {
      // Retry with planner estimate (cheap, no exact scan).
      let retry = supabase.from(schema.table).select(schema.primaryKey, { count: 'estimated', head: true });
      if (authFn) retry = authFn(retry) as unknown as typeof retry;
      retry = applyFilters(retry, schema, filters, enrichedCtx) as unknown as typeof retry;
      if (search && schema.searchable.length > 0) retry = applySearch(retry, schema, search) as unknown as typeof retry;
      const { error: retryError, count: retryCount } = await retry;
      if (retryError) {
        throw new ListingError('LISTING_INTERNAL_ERROR', `Estimated count fallback failed: ${retryError.message}`);
      }
      return { count: retryCount ?? null, countStrategy: 'estimated' };
    }
    throw new ListingError('LISTING_INTERNAL_ERROR', error.message, { details: { code: error.code } });
  }

  return { count: count ?? null, countStrategy: 'exact' };
}

// ----------------------------------------------------------------------------
// Validation helpers — every failure raises ListingError with a stable code.
// ----------------------------------------------------------------------------

function validatePage(p: unknown): number {
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 0) {
    throw new ListingError('INVALID_PAGE', `page must be a non-negative integer; got ${JSON.stringify(p)}`);
  }
  return p;
}

function validatePageSize(p: unknown): number {
  const requested = typeof p === 'number' && Number.isInteger(p) && p > 0 ? p : DEFAULT_PAGE_SIZE;
  const clamped = Math.min(Math.max(requested, MIN_PAGE_SIZE), MAX_PAGE_SIZE);
  return clamped;
}

function validateSort(schema: ListingSchema, sort: ListingQuery['sort']): { column: string; direction: 'asc' | 'desc' } {
  if (!sort) return schema.defaultSort;
  if (!sort.column || !schema.sortable[sort.column]) {
    throw new ListingError('INVALID_SORT_COLUMN', `Sort column '${sort.column}' is not in the schema's sortable allowlist`, {
      details: { column: sort.column, allowed: Object.keys(schema.sortable) },
    });
  }
  if (sort.direction !== 'asc' && sort.direction !== 'desc') {
    throw new ListingError('INVALID_SORT_DIRECTION', `Sort direction must be 'asc' or 'desc'; got ${JSON.stringify(sort.direction)}`);
  }
  return { column: sort.column, direction: sort.direction };
}

function validateFilters(schema: ListingSchema, filters: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    const decl = schema.filters[key];
    if (!decl) {
      throw new ListingError('UNKNOWN_FILTER', `Unknown filter key '${key}'`, {
        details: { key, allowed: Object.keys(schema.filters) },
      });
    }
    out[key] = validateFilterValue(key, decl, value);
  }
  return out;
}

function validateFilterValue(key: string, decl: FilterDeclaration, value: unknown): unknown {
  switch (decl.kind) {
    case 'virtual': {
      // Two-phase validation: enum allowlist (if declared) runs before
      // the resolver. Multi-valued virtuals normalise to an array.
      const arr = Array.isArray(value) ? value : [value];
      if (decl.values) {
        for (const v of arr) {
          if (typeof v !== 'string' || !decl.values.includes(v)) {
            throw new ListingError('INVALID_FILTER', `Filter '${key}' value '${String(v)}' is not in allowed virtual values`, {
              details: { field: `filters.${key}`, allowed: decl.values },
            });
          }
        }
      }
      return decl.multi ? arr : arr[0];
    }
    case 'enum': {
      const arr = Array.isArray(value) ? value : [value];
      for (const v of arr) {
        if (typeof v !== 'string' || !decl.values.includes(v)) {
          throw new ListingError('INVALID_FILTER', `Filter '${key}' value '${String(v)}' is not in allowed enum`, {
            details: { field: `filters.${key}`, allowed: decl.values },
          });
        }
      }
      return decl.multi ? arr : arr[0];
    }
    case 'string': {
      const arr = Array.isArray(value) ? value : [value];
      const min = decl.minLength ?? 1;
      const max = decl.maxLength ?? 255;
      for (const v of arr) {
        if (typeof v !== 'string' || v.length < min || v.length > max) {
          throw new ListingError('INVALID_FILTER', `Filter '${key}' must be a string of length ${min}-${max}`, {
            details: { field: `filters.${key}` },
          });
        }
      }
      return decl.multi ? arr : arr[0];
    }
    case 'integer': {
      const arr = Array.isArray(value) ? value : [value];
      for (const v of arr) {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isInteger(n) || (decl.min !== undefined && n < decl.min) || (decl.max !== undefined && n > decl.max)) {
          throw new ListingError('INVALID_FILTER', `Filter '${key}' must be an integer in range`, {
            details: { field: `filters.${key}`, min: decl.min, max: decl.max },
          });
        }
      }
      return decl.multi ? arr.map(Number) : Number(arr[0]);
    }
    case 'date': {
      if (typeof value !== 'string' || !isIsoDate(value)) {
        throw new ListingError('INVALID_FILTER', `Filter '${key}' must be an ISO 8601 date string`, {
          details: { field: `filters.${key}` },
        });
      }
      return value;
    }
    case 'dateRange': {
      if (!isDateRange(value)) {
        throw new ListingError('INVALID_FILTER', `Filter '${key}' must be { from, to } ISO 8601 strings`, {
          details: { field: `filters.${key}` },
        });
      }
      const v = value as { from: string; to: string };
      if (new Date(v.from) > new Date(v.to)) {
        throw new ListingError('INVALID_RANGE', `Filter '${key}' has from > to`, { details: { field: `filters.${key}`, ...v } });
      }
      return v;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new ListingError('INVALID_FILTER', `Filter '${key}' must be a boolean`, { details: { field: `filters.${key}` } });
      }
      return value;
    }
    case 'tristate': {
      if (value !== 'has' && value !== 'none') {
        throw new ListingError('INVALID_FILTER', `Filter '${key}' must be 'has' or 'none'`, { details: { field: `filters.${key}` } });
      }
      return value;
    }
    case 'jsonbHas': {
      if (typeof value !== 'string') {
        throw new ListingError('INVALID_FILTER', `Filter '${key}' must be a string`, { details: { field: `filters.${key}` } });
      }
      return value;
    }
  }
}

function validateSearch(schema: ListingSchema, search: string | undefined): string | undefined {
  if (search === undefined) return undefined;
  const trimmed = search.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length < MIN_SEARCH_LENGTH) {
    throw new ListingError('SEARCH_TOO_SHORT', `Search must be at least ${MIN_SEARCH_LENGTH} characters`);
  }
  if (trimmed.length > MAX_SEARCH_LENGTH) {
    throw new ListingError('INVALID_FILTER', `Search must be at most ${MAX_SEARCH_LENGTH} characters`);
  }
  if (schema.searchable.length === 0) {
    throw new ListingError('INVALID_FILTER', `Schema '${schema.id}' has no searchable columns`);
  }
  return trimmed;
}

// ----------------------------------------------------------------------------
// Projection rendering — resolves ProjectionItem[] to a Supabase select string.
// ----------------------------------------------------------------------------

function renderProjection(items: ReadonlyArray<ProjectionItem>): string {
  return items.map(renderProjectionItem).join(', ');
}

function renderProjectionItem(item: ProjectionItem): string {
  if (typeof item === 'string') return item;
  if ('col' in item) {
    return item.as ? `${item.as}:${item.col}` : item.col;
  }
  if ('computed' in item) {
    // Supabase JS client doesn't natively support arbitrary SQL expressions
    // in select(). At this layer we render the expression using
    // PostgREST's "computed_columns" convention only if the operator has
    // declared one; otherwise the validator (validate-schema.ts) rejects
    // computed projections at module load. For the v1 implementation we
    // emit `<as>:<col>` and leave the expression to be evaluated by a
    // module-provided VIEW or SQL function — see spec §4.1b.
    // For now: require an `as` and error if reached at runtime without
    // a backing column; module authors should expose computed columns
    // via a view named '<table>_listing_view' until the Supabase client
    // gains expression support.
    throw new ListingError(
      'LISTING_SCHEMA_INVALID',
      `Computed projection '${item.as}' requires a backing view or SQL function (see spec §4.1b for v1 limitation)`,
      { details: { as: item.as } }
    );
  }
  if ('fkLookup' in item) {
    // PostgREST embedded resource notation:
    //   `<as>:<referencedTable>!<fkColumn>(<selectColumn>)`
    const { referencedTable, fkColumn, selectColumn } = item.fkLookup;
    return `${item.as}:${referencedTable}!${fkColumn}(${selectColumn})`;
  }
  // Should be unreachable.
  throw new ListingError('LISTING_SCHEMA_INVALID', 'Unrecognised ProjectionItem');
}

// Expose the helper so factories can render the same way for response shaping.
export { renderProjection };

// Renders a ComputedExpr to a parameterised SQL fragment + params array.
// Reserved for the future Supabase-client-with-expressions path; not
// invoked in the v1 implementation but kept here so callers can reach it
// once the runtime supports SQL expressions.
export function renderComputedExpr(_expr: ComputedExpr): { sql: string; params: unknown[] } {
  throw new ListingError(
    'LISTING_SCHEMA_INVALID',
    'renderComputedExpr is reserved for v2 — express computed columns via a SQL view in v1'
  );
}

// ----------------------------------------------------------------------------
// Filter application — invokes the parameterised builder per filter kind.
// ----------------------------------------------------------------------------

function applyFilters(
  qb: ListingQueryBuilder,
  schema: ListingSchema,
  filters: Record<string, unknown>,
  ctx: HandlerContext,
): ListingQueryBuilder {
  let q = qb;
  for (const [key, value] of Object.entries(filters)) {
    const decl = schema.filters[key];
    q = applyFilter(q, decl, value, key, ctx);
  }
  return q;
}

function applyFilter(
  qb: ListingQueryBuilder,
  decl: FilterDeclaration,
  value: unknown,
  key: string,
  ctx: HandlerContext,
): ListingQueryBuilder {
  switch (decl.kind) {
    case 'virtual': {
      return decl.resolve(value, qb, ctx);
    }
    case 'enum':
    case 'string':
    case 'integer': {
      if (Array.isArray(value)) {
        return value.length === 1 ? qb.eq(decl.column, value[0]) : qb.in(decl.column, value);
      }
      return qb.eq(decl.column, value);
    }
    case 'date': {
      // The matching filter key signals direction by its presence in the
      // filters object. Convention: keys ending '...After' → gte, '...Before' → lte.
      if (/(After|From|Since)$/.test(key)) return qb.gte(decl.column, value);
      if (/(Before|To|Until)$/.test(key)) return qb.lte(decl.column, value);
      return qb.eq(decl.column, value);
    }
    case 'dateRange': {
      const v = value as { from: string; to: string };
      return qb.gte(decl.column, v.from).lte(decl.column, v.to);
    }
    case 'boolean': {
      return qb.eq(decl.column, value);
    }
    case 'tristate': {
      return value === 'has' ? qb.not(decl.column, 'is', null) : qb.is(decl.column, null);
    }
    case 'jsonbHas': {
      // PostgREST's `cs` operator (contains) on a jsonb column.
      const obj: Record<string, unknown> = { [decl.key]: value };
      return qb.contains(decl.column, obj);
    }
  }
}

// ----------------------------------------------------------------------------
// Search application — OR'd ilikes across schema.searchable.
// ----------------------------------------------------------------------------

function applySearch(qb: ListingQueryBuilder, schema: ListingSchema, search: string): ListingQueryBuilder {
  // Supabase .or() takes a comma-separated string of condition fragments.
  // Each ilike value is auto-quoted by PostgREST when used through .or() with the standard syntax.
  const wildcardEscaped = search.replace(/[*]/g, '').replace(/[%_]/g, (c) => `\\${c}`);
  const fragments = schema.searchable.map((col) => `${col}.ilike.%${wildcardEscaped}%`);
  return qb.or(fragments.join(','));
}

// ----------------------------------------------------------------------------
// Context enricher.
// ----------------------------------------------------------------------------

async function runEnricher(ctx: HandlerContext, schema: ListingSchema): Promise<HandlerContext> {
  if (!schema.contextEnricher) return ctx;
  try {
    const extras = await schema.contextEnricher(ctx);
    return { ...ctx, extras: { ...ctx.extras, ...extras } };
  } catch (err) {
    throw new ListingError(
      'LISTING_INTERNAL_ERROR',
      `Context enricher failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ----------------------------------------------------------------------------
// Slow-count fallback.
// ----------------------------------------------------------------------------

interface RetryArgs {
  page: number;
  pageSize: number;
  sort: { column: string; direction: 'asc' | 'desc' };
  filters: Record<string, unknown>;
  search: string | undefined;
  projectionItems: ReadonlyArray<ProjectionItem>;
  authFn: SupabaseFilterFn | null;
}

async function retryWithEstimatedCount<Row>(opts: BuildListingQueryOpts, args: RetryArgs): Promise<ListingResult<Row>> {
  const { schema, supabase, ctx } = opts;
  const selectString = renderProjection(args.projectionItems);

  let qb = supabase.from(schema.table).select(selectString, { count: 'estimated' });
  if (args.authFn) qb = args.authFn(qb) as unknown as typeof qb;
  qb = applyFilters(qb, schema, args.filters, ctx) as unknown as typeof qb;
  if (args.search && schema.searchable.length > 0) {
    qb = applySearch(qb, schema, args.search) as unknown as typeof qb;
  }
  const sortDbColumn = schema.sortable[args.sort.column];
  qb = qb.order(sortDbColumn, { ascending: args.sort.direction === 'asc' });
  if (args.sort.column !== schema.primaryKey) {
    qb = qb.order(schema.primaryKey, { ascending: true });
  }
  const from = args.page * args.pageSize;
  const to = from + args.pageSize - 1;
  qb = qb.range(from, to);

  const { data, error, count } = await qb;
  if (error) {
    throw new ListingError('LISTING_INTERNAL_ERROR', `Estimated-count fallback failed: ${error.message}`);
  }

  return {
    rows: (data as Row[]) ?? [],
    page: args.page,
    pageSize: args.pageSize,
    totalCount: null,
    totalCountEstimate: count ?? undefined,
    countStrategy: 'estimated',
  };
}

// ----------------------------------------------------------------------------
// Tiny helpers.
// ----------------------------------------------------------------------------

function isIsoDate(s: string): boolean {
  if (typeof s !== 'string') return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s);
}

function isDateRange(v: unknown): v is { from: string; to: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { from?: unknown }).from === 'string' &&
    typeof (v as { to?: unknown }).to === 'string' &&
    isIsoDate((v as { from: string }).from) &&
    isIsoDate((v as { to: string }).to)
  );
}
