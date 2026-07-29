---
paths: ["packages/**/*listing*.ts", "packages/**/*listing*.tsx", "packages/**/listing/**"]
source: gatewaze-skills/production-readiness/references/listing-primitive.md
---

# Listing primitive (`packages/shared/src/listing/`)

The shared listing primitive is the canonical pattern for paginated
queries across consumers (admin, publicApi, mcp, portal). It
encapsulates pagination, sort, filter, search, auth-filter, projection,
and count-strategy in one `buildListingQuery()` function.

## Don't reach into PostgrestFilterBuilder generics directly

The original code had `qb: any` parameters on the helper functions
because the full `PostgrestFilterBuilder<Schema, Row, Result, RelationName,
Relationships, Method>` generic is six type parameters deep and breaks
when chained.

**The structural-builder pattern:** define a minimal interface
covering only the methods the listing primitive uses:

```ts
// packages/shared/src/listing/types.ts
export interface ListingQueryBuilder {
  eq(column: string, value: unknown): ListingQueryBuilder;
  neq(column: string, value: unknown): ListingQueryBuilder;
  gt(column: string, value: unknown): ListingQueryBuilder;
  gte(column: string, value: unknown): ListingQueryBuilder;
  lt(column: string, value: unknown): ListingQueryBuilder;
  lte(column: string, value: unknown): ListingQueryBuilder;
  in(column: string, values: readonly unknown[]): ListingQueryBuilder;
  is(column: string, value: unknown): ListingQueryBuilder;
  not(column: string, op: string, value: unknown): ListingQueryBuilder;
  like(column: string, value: string): ListingQueryBuilder;
  ilike(column: string, value: string): ListingQueryBuilder;
  contains(column: string, value: unknown): ListingQueryBuilder;
  containedBy(column: string, value: unknown): ListingQueryBuilder;
  overlaps(column: string, values: readonly unknown[]): ListingQueryBuilder;
  match(query: Record<string, unknown>): ListingQueryBuilder;
  filter(column: string, operator: string, value: unknown): ListingQueryBuilder;
  or(filters: string, opts?: { foreignTable?: string; referencedTable?: string }): ListingQueryBuilder;
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): ListingQueryBuilder;
  range(from: number, to: number): ListingQueryBuilder;
}

export type SupabaseFilterFn = (q: ListingQueryBuilder) => ListingQueryBuilder;
```

PostgrestFilterBuilder is structurally compatible (has all those
methods), so passing the real builder into a function expecting
`ListingQueryBuilder` works without explicit cast. The reverse direction
(narrow → wide) needs a boundary cast.

## Boundary casts when re-assigning

The helper functions `applyFilters`, `applyFilter`, `applySearch`
return `ListingQueryBuilder`. The call site re-assigns to `qb` whose
declared type is the wider Supabase builder. Cast at the assignment:

```ts
let qb = supabase.from(schema.table).select(selectString, { count: 'exact' });

if (authFn) qb = authFn(qb) as unknown as typeof qb;

qb = applyFilters(qb, schema, filters, enrichedCtx) as unknown as typeof qb;

if (search && schema.searchable.length > 0) {
  qb = applySearch(qb, schema, search) as unknown as typeof qb;
}
```

The `as unknown as typeof qb` chain is intentional — `unknown` makes
the narrow→wide cast explicit at the boundary instead of relying on
TS's structural compat.

**Existing usage:** `packages/shared/src/listing/build-query.ts` (10
boundary cast sites — every place a helper return is re-assigned to
qb / retry).

## Adding methods to ListingQueryBuilder

When a module's virtual filter or auth-filter resolver needs a builder
method that isn't in the interface, add it. The first time we shipped
the interface, `lt` was missing because the events module's virtual
filter `inactive` was the only caller — adding `lt` (and incidentally
`gt`, `neq`, `like`, `match`, `filter`) was a one-line change.

Any method on `PostgrestFilterBuilder` is fair game; the interface is
intentionally a structural subset.

## Virtual filter resolver shape

The `virtual` filter kind takes a resolver function:

```ts
{
  kind: 'virtual';
  column: string;
  values?: readonly string[];
  multi?: boolean;
  resolve: (value: unknown, qb: ListingQueryBuilder, ctx: HandlerContext) => ListingQueryBuilder;
}
```

The resolver MUST use parameterised builder methods only — no raw SQL
concat. The platform validator doesn't statically inspect the function
body, so module authors are trusted; the listing primitive's unit
tests cover each resolver. See `gatewaze-modules/modules/events/listing-schema.ts`
for canonical examples.

## Schema validator promise handlers

`packages/shared/src/listing/validate-schema.ts` has four `.then()`
calls that take an identity function for the success path:

```ts
const { data, error } = await supabase.rpc('listing_introspect_columns', {
  p_table: table,
}).then(
  (r) => r,                               // ← let TS infer
  () => ({ data: null, error: { message: 'rpc-missing' } as const })
);
```

DO NOT add `(r: any) => r` — TS infers the resolved shape from the
promise chain. The previous version had `(r: any) => r` and that's a
removed any.
