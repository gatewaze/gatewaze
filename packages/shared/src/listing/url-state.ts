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
 * Unknown keys (already in `existing`) are preserved untouched.
 */
export function listingQueryToSearchParams(q: ListingQuery, existing?: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  // Preserve unknown keys first so reset semantics are deterministic.
  if (existing) {
    const reservedKeys = new Set(['page', 'pageSize', 'sort', 'dir', 'q']);
    for (const [k, v] of existing.entries()) {
      if (reservedKeys.has(k)) continue;
      // Strip filter keys that we'll re-add below.
      // The caller decides what's a filter by passing the schema to the
      // parse() function; for serialise, we trust the ListingQuery's
      // filters object as authoritative — drop any key that appears in
      // q.filters to avoid duplicates, and keep the rest.
      if (q.filters && k in q.filters) continue;
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
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) out.append(key, String(v));
      } else if (typeof value === 'object') {
        // dateRange: { from, to }
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

    const all = s.getAll(filterKey);
    if (all.length === 0) continue;

    const isMulti =
      (decl.kind === 'enum' && decl.multi) ||
      (decl.kind === 'string' && decl.multi) ||
      (decl.kind === 'integer' && decl.multi);

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
