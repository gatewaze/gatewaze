/**
 * URL ↔ ListingQuery serializer per spec-platform-listing-pattern.md §12.
 *
 * Used by the admin React component and the portal SSR loader. Single
 * source of truth so the admin URL and any portal-shared link round-trip
 * identically.
 */

import type { ListingQuery, ListingSchema } from './types';

/**
 * Serialise a ListingQuery into URLSearchParams.
 * Pagination flat (page, pageSize); sort flat (sort, dir); single-valued
 * filters flat; list filters as repeated keys; search as `q`.
 *
 * The schema is required so we know which existing URL params are
 * filter-shaped (and should be dropped + re-emitted from the
 * authoritative query.filters) vs unknown brand-injected params we
 * should preserve.
 */
export function listingQueryToSearchParams(
  q: ListingQuery,
  schema: ListingSchema,
  existing?: URLSearchParams
): URLSearchParams {
  const out = new URLSearchParams();

  const reservedKeys = new Set(['page', 'pageSize', 'sort', 'dir', 'q']);
  // All keys the schema knows about (regular + dateRange parts). These
  // get dropped from the "preserve unknown" pass below; the new filters
  // are emitted as the authoritative source.
  const schemaFilterKeys = new Set<string>();
  for (const [filterKey, decl] of Object.entries(schema.filters)) {
    if (decl.kind === 'dateRange') {
      schemaFilterKeys.add(`${filterKey}.from`);
      schemaFilterKeys.add(`${filterKey}.to`);
    } else {
      schemaFilterKeys.add(filterKey);
    }
  }

  // Preserve only params we don't recognise.
  if (existing) {
    for (const [k, v] of existing.entries()) {
      if (reservedKeys.has(k)) continue;
      if (schemaFilterKeys.has(k)) continue;
      out.append(k, v);
    }
  }

  out.set('page', String(q.page));
  out.set('pageSize', String(q.pageSize));

  if (q.sort) {
    out.set('sort', q.sort.column);
    out.set('dir', q.sort.direction);
  }

  if (q.search) {
    out.set('q', q.search);
  }

  if (q.filters) {
    for (const [key, value] of Object.entries(q.filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        for (const v of value) out.append(key, String(v));
      } else if (typeof value === 'object') {
        if ('from' in value && 'to' in value) {
          const r = value as { from: string; to: string };
          out.set(`${key}.from`, r.from);
          out.set(`${key}.to`, r.to);
        }
      } else {
        out.set(key, String(value));
      }
    }
  }

  return out;
}

/**
 * Parse URLSearchParams back into a ListingQuery, using the schema to
 * decide whether each key is a list-typed filter (repeated → array).
 */
export function listingQueryFromSearchParams(
  s: URLSearchParams,
  schema: ListingSchema
): ListingQuery {
  const page = parseIntOr(s.get('page'), 0);
  const pageSize = parseIntOr(s.get('pageSize'), 50);
  const sortColumn = s.get('sort') ?? undefined;
  const sortDir = s.get('dir');
  const sort = sortColumn && (sortDir === 'asc' || sortDir === 'desc')
    ? { column: sortColumn, direction: sortDir as 'asc' | 'desc' }
    : undefined;
  const search = s.get('q') ?? undefined;

  const filters: Record<string, unknown> = {};
  for (const filterKey of Object.keys(schema.filters)) {
    const decl = schema.filters[filterKey];

    // dateRange uses dotted keys: <key>.from, <key>.to
    if (decl.kind === 'dateRange') {
      const from = s.get(`${filterKey}.from`);
      const to = s.get(`${filterKey}.to`);
      if (from && to) filters[filterKey] = { from, to };
      continue;
    }

    // `topics` and other virtual multi filters arrive either as repeated
    // `?topics=foo&topics=bar` keys (URLSearchParams.append) or as a
    // single comma-joined string (`?topics=foo,bar`) emitted by the
    // legacy URL builder. Handle both.
    let all = s.getAll(filterKey);
    if (decl.kind === 'virtual' && decl.multi && all.length === 1 && all[0].includes(',')) {
      all = all[0].split(',').map((p) => p.trim()).filter(Boolean);
    }
    if (all.length === 0) continue;

    const isMulti =
      (decl.kind === 'enum' && decl.multi) ||
      (decl.kind === 'string' && decl.multi) ||
      (decl.kind === 'integer' && decl.multi) ||
      (decl.kind === 'virtual' && decl.multi);

    if (isMulti) {
      filters[filterKey] = all;
    } else {
      filters[filterKey] =
        decl.kind === 'boolean' ? all[0] === 'true' : all[0];
    }
  }

  return { page, pageSize, sort, filters, search };
}

function parseIntOr(s: string | null, fallback: number): number {
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
