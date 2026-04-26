/**
 * Platform listing-pattern types.
 * Per spec-platform-listing-pattern.md §4 + §5.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// HandlerContext — passed to every authFilter and contextEnricher
// ============================================================================

export interface HandlerContext {
  consumer: 'admin' | 'publicApi' | 'mcp' | 'portal';
  user?: {
    id: string;
    role: 'admin' | 'super_admin' | 'user' | 'anonymous';
    scopes?: readonly string[];
  };
  apiKey?: { id: string; scopes: readonly string[] };
  agent?: { id: string; scope: string };
  brandId?: string;
  ip: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  requestId: string;
  /**
   * Module-extensible map populated by an optional `contextEnricher`
   * declared on the listing schema. Keep keys namespaced (e.g. 'events.tenantId').
   */
  extras: Readonly<Record<string, unknown>>;
}

// ============================================================================
// SupabaseFilterFn — pure mutation of a parameterised query builder
// ============================================================================

/**
 * Returning a function that mutates a Supabase query builder keeps
 * everything parameterised; raw SQL string concatenation is forbidden in
 * the listing primitive.
 */
export type SupabaseFilterFn = (q: any) => any;

// ============================================================================
// ProjectionItem — column references, computed expressions, FK lookups
// ============================================================================

/**
 * A computed projection expression. AST-validated server-side; literals
 * become parameterised values. The list of allowed shapes is exhaustive;
 * extending requires a platform spec change.
 */
export type ComputedExpr =
  | { fn: 'concat'; args: ComputedExpr[]; sep?: string }
  | { fn: 'coalesce'; args: ComputedExpr[] }
  | { fn: 'lower' | 'upper' | 'trim'; arg: ComputedExpr }
  | { fn: 'substr'; arg: ComputedExpr; start: number; length?: number }
  | { fn: 'extract'; field: 'year' | 'month' | 'day' | 'hour' | 'dow'; from: ComputedExpr }
  | { fn: 'arithmetic'; op: '+' | '-' | '*' | '/'; left: ComputedExpr; right: ComputedExpr }
  | { fn: 'caseWhen'; cases: Array<{ when: { col: string; eq: string | number | boolean }; then: ComputedExpr }>; else?: ComputedExpr }
  | { col: string }
  | { literal: string | number | boolean | null };

/**
 * FK lookup projection: a single-row reference to another table.
 * The validator confirms `referencedColumn` is PRIMARY KEY or UNIQUE on
 * `referencedTable` so 1:1 cardinality is structurally guaranteed.
 */
export interface FkLookup {
  /** Local FK column on this listing's table (must be indexed). */
  fkColumn: string;
  /** Referenced table; must have a UNIQUE/PK on referencedColumn. */
  referencedTable: string;
  /** Column on the referenced table the FK points at (typically PK). */
  referencedColumn: string;
  /** Single column to project from the referenced table. */
  selectColumn: string;
}

export type ProjectionItem =
  | string
  | { col: string; as?: string }
  | { computed: ComputedExpr; as: string }
  | { fkLookup: FkLookup; as: string };

// ============================================================================
// FilterDeclaration — declarative filter contract
// ============================================================================

export type FilterDeclaration =
  | { kind: 'enum'; column: string; values: readonly string[]; multi?: boolean }
  | { kind: 'string'; column: string; minLength?: number; maxLength?: number; multi?: boolean }
  | { kind: 'integer'; column: string; min?: number; max?: number; multi?: boolean }
  | { kind: 'date'; column: string; granularity?: 'date' | 'timestamp' }
  | { kind: 'dateRange'; column: string }
  | { kind: 'boolean'; column: string }
  | {
      kind: 'tristate';
      column: string;
      map: { has: 'NOT NULL' | true; none: 'NULL' | false };
    }
  | { kind: 'jsonbHas'; column: string; key: string }
  /**
   * Virtual filter — module-supplied resolver runs against the Supabase
   * query builder. The platform validator enforces `column` is in
   * `indexedColumns` (the resolver ultimately filters on it) and an
   * optional enum-style `values` allowlist before the resolver runs.
   *
   * The resolver MUST use parameterised builder methods only
   * (`.eq/.in/.gte/.lte/.ilike/.is/.or/.overlaps/.contains`) — raw SQL
   * concat is forbidden as for any other listing filter. The validator
   * does not statically inspect the function body; module authors are
   * trusted, and a unit-test guideline in the platform spec covers
   * testing each resolver.
   *
   * `ctx.extras` is the canonical place for per-request enriched data
   * (e.g. snapshot timestamps, brand-specific lookup tables) that the
   * resolver might read.
   */
  | {
      kind: 'virtual';
      column: string;
      values?: readonly string[];
      multi?: boolean;
      resolve: (
        value: unknown,
        qb: any,
        ctx: HandlerContext,
      ) => any;
    };

// ============================================================================
// SummaryDeclaration — optional per-module summary endpoint contract
// ============================================================================

export interface SummaryDeclaration {
  /** Stable id used as the cache key prefix and matches GET /:id/summary. */
  id: string;
  ranges: ReadonlyArray<'all' | 'last_30d' | 'next_30d' | 'this_month' | 'custom'>;
  cacheTtlSeconds?: number;
  /** SQL function (RPC) name; output validated against outputSchema. */
  rpc: string;
  /** Zod schema for runtime + static validation of the response. */
  // We don't import zod here — keep the field unknown to avoid forcing a dep.
  outputSchema: unknown;
}

// ============================================================================
// Display columns for the admin <DataListingTable>
// ============================================================================

import type { ReactNode } from 'react';

type AnyRow = Record<string, unknown>;

export type AdminDisplayColumn =
  | { kind: 'text'; key: string; header: string; width?: number }
  | { kind: 'date'; key: string; header: string; format?: 'date' | 'datetime' | 'relative'; tz?: string }
  | { kind: 'enum-badge'; key: string; header: string; colors: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'purple' | 'cyan'> }
  | { kind: 'link'; key: string; header: string; to: (row: AnyRow) => string; label?: (row: AnyRow) => string }
  | { kind: 'boolean'; key: string; header: string; trueLabel?: string; falseLabel?: string }
  | { kind: 'number'; key: string; header: string; format?: 'integer' | 'decimal' | 'currency' | 'percent'; locale?: string }
  | { kind: 'json'; key: string; header: string; preview?: 'collapsed' | 'inline' }
  /**
   * Image / thumbnail cell. The value is a URL (or storage path the host
   * application resolves). Modules opt in only if their entity has a
   * representative image (events have `event_logo`, sponsors might have
   * `logo_url`, etc.).
   */
  | {
      kind: 'image';
      key: string;
      header: string;
      /** Square pixel size for the rendered thumbnail; default 40. */
      size?: number;
      /** Whether the thumbnail is round (avatars) or square-rounded (logos). */
      shape?: 'square' | 'circle';
      /** Optional alt-text resolver pulled from another column. */
      alt?: (row: AnyRow) => string;
    }
  | { kind: 'custom'; key: string; header: string; render: (row: AnyRow) => ReactNode };

// ============================================================================
// PII acknowledgement — structured exception for non-admin projections
// ============================================================================

export interface PiiExposureAcknowledgement {
  column: string;
  consumer: 'publicApi' | 'mcp' | 'portal';
  justification: string;
  approvedBy: string;
  approvedInPr: string;
  /** ISO-8601 date; CI fails build when in the past. */
  reviewByDate: string;
}

// ============================================================================
// ListingSchema — the manifest contract
// ============================================================================

/**
 * Table-wide visual options. Each listing schema can opt into a
 * different look — events typically wants thumbnails + comfortable
 * density, while a settings table might want compact + no card wrap.
 * Defaults match the platform admin's standard table look so most
 * modules can omit this entirely.
 */
export interface AdminTableStyle {
  /** Row vertical padding. compact = rich data, comfortable = standard, spacious = thumbnail-heavy. */
  density?: 'compact' | 'comfortable' | 'spacious';
  /** Wrap the table in a Card; default true. */
  card?: boolean;
  /** Stripe alternate rows; default false. */
  striped?: boolean;
  /** Hover-highlight rows; default true. */
  hover?: boolean;
}

export interface ListingSchema {
  id: string;
  table: string;
  primaryKey: string;
  defaultSort: { column: string; direction: 'asc' | 'desc' };
  /** Per-entity admin table styling — see AdminTableStyle. */
  adminTableStyle?: AdminTableStyle;
  projections: {
    admin: ReadonlyArray<ProjectionItem>;
    publicApi: ReadonlyArray<ProjectionItem>;
    mcp: ReadonlyArray<ProjectionItem>;
    portal: ReadonlyArray<ProjectionItem>;
  };
  /** Allowed sort columns; key = camelCase API name, value = DB column name. */
  sortable: Record<string, string>;
  filters: Record<string, FilterDeclaration>;
  searchable: ReadonlyArray<string>;
  indexedColumns: ReadonlyArray<string>;
  /**
   * Allowlist of columns the distinct-values endpoint will return for
   * the admin filter UI. Each column SHOULD be indexed (otherwise the
   * DISTINCT scan is expensive). Defaults to empty (no distinct
   * endpoint exposed). Per spec §6 — modules opt in per-column to
   * prevent accidental enumeration of sensitive columns.
   */
  distinctableColumns?: ReadonlyArray<string>;
  authFilters: {
    admin?: ((ctx: HandlerContext) => SupabaseFilterFn | null) | null;
    publicApi?: ((ctx: HandlerContext) => SupabaseFilterFn | null) | null;
    mcp?: ((ctx: HandlerContext) => SupabaseFilterFn | null) | null;
    portal?: ((ctx: HandlerContext) => SupabaseFilterFn | null) | null;
  };
  /** Display config for the shared admin <DataListingTable>. */
  displayColumns?: { admin: AdminDisplayColumn[] };
  summary?: SummaryDeclaration;
  piiExposureAcknowledgements?: PiiExposureAcknowledgement[];
  contextEnricher?: (rawCtx: HandlerContext) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

// ============================================================================
// ListingQuery + ListingResult — the request/response contract
// ============================================================================

export interface ListingQuery {
  page: number;
  pageSize: number;
  sort?: { column: string; direction: 'asc' | 'desc' };
  filters?: Record<string, unknown>;
  search?: string;
}

export interface ListingResult<Row = Record<string, unknown>> {
  rows: Row[];
  page: number;
  pageSize: number;
  /** Exact count when available; null when count timed out and we fell back. */
  totalCount: number | null;
  totalCountEstimate?: number;
  countStrategy: 'exact' | 'estimated' | 'planned';
  /**
   * Snapshot timestamp pinned for time-sensitive virtual filters.
   * The portal route handler echoes the value back so the client uses
   * the same `ts` for every page in a session, preventing the
   * "drifting now" boundary bug. Only populated for the portal
   * consumer; admin/publicApi/mcp leave it undefined.
   */
  ts?: string;
}

// ============================================================================
// Internal: BuildListingQueryOpts / BuildListingQueryDeps
// ============================================================================

export interface BuildListingQueryOpts {
  schema: ListingSchema;
  consumer: 'admin' | 'publicApi' | 'mcp' | 'portal';
  query: ListingQuery;
  ctx: HandlerContext;
  supabase: SupabaseClient;
}

// ============================================================================
// Listing-level error — surfaced via the platform error envelope
// ============================================================================

export type ListingErrorCode =
  | 'INVALID_PAGE'
  | 'INVALID_PAGE_SIZE'
  | 'INVALID_SORT_COLUMN'
  | 'INVALID_SORT_DIRECTION'
  | 'UNKNOWN_FILTER'
  | 'INVALID_FILTER'
  | 'INVALID_RANGE'
  | 'SEARCH_TOO_SHORT'
  | 'INVALID_TS'
  | 'MISSING_TS_FOR_PAGINATION'
  | 'LISTING_NOT_FOUND'
  | 'LISTING_SCHEMA_INVALID'
  | 'INDEX_MISSING'
  | 'MISSING_EXTENSION_PG_TRGM'
  | 'LISTING_INTERNAL_ERROR';

export class ListingError extends Error {
  readonly code: ListingErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ListingErrorCode, message: string, opts?: { httpStatus?: number; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'ListingError';
    this.code = code;
    this.httpStatus = opts?.httpStatus ?? defaultStatusFor(code);
    this.details = opts?.details;
  }

  toEnvelope(): { error: { code: string; message: string; details?: Record<string, unknown> } } {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

function defaultStatusFor(code: ListingErrorCode): number {
  switch (code) {
    case 'INVALID_PAGE':
    case 'INVALID_PAGE_SIZE':
    case 'INVALID_SORT_COLUMN':
    case 'INVALID_SORT_DIRECTION':
    case 'UNKNOWN_FILTER':
    case 'INVALID_FILTER':
    case 'INVALID_RANGE':
    case 'SEARCH_TOO_SHORT':
    case 'INVALID_TS':
    case 'MISSING_TS_FOR_PAGINATION':
      return 400;
    case 'LISTING_NOT_FOUND':
      return 404;
    case 'LISTING_SCHEMA_INVALID':
    case 'INDEX_MISSING':
    case 'MISSING_EXTENSION_PG_TRGM':
      return 503;
    case 'LISTING_INTERNAL_ERROR':
    default:
      return 500;
  }
}
