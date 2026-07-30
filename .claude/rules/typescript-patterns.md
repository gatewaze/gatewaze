---
paths: ["packages/**/*.ts", "packages/**/*.tsx", "scripts/**/*.ts"]
source: gatewaze-skills/production-readiness/references/typescript-patterns.md
---

# TypeScript patterns

How the prod-hardening pass got from 4 packages × dozens of TS errors
to 0 across the workspace, and what to do when you hit the same
shapes.

## Supabase clients without a generated `Database` type

The repo doesn't currently generate `Database` types. Without them,
`createClient(...)` resolves rows to `never` for `.insert()` and
`.select()` overloads, making every PostgREST call fail to type-check.

**Fix at the call site:**
```ts
import { createClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any -- intentional Database/Schema generics; see comment */
let _serviceSupabase: ReturnType<typeof createClient<any, any, any>> | null = null;
function getServiceSupabase() {
  if (!_serviceSupabase) {
    _serviceSupabase = createClient<any, any, any>(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _serviceSupabase;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

Two non-obvious things:

1. The variable annotation MUST be `ReturnType<typeof createClient<any,
   any, any>>`. Plain `ReturnType<typeof createClient>` resolves the
   variable's row types to `never`, which cascades into every
   `.insert()` and `.select()` overload below.

2. Wrap in a block-level `eslint-disable` / `eslint-enable` pair
   rather than a per-line pragma. Three line-level disables on
   `createClient<any, any, any>` count as 3 anys and clutter the lint
   output; the block keeps the intentional any usage scoped.

**Existing fix:** `packages/portal/app/api/live-chat/route.ts:13-26`.

## Typed row reads via `.maybeSingle<RowShape>()`

When you control the SELECT shape, give Supabase a row type via the
generic on `.maybeSingle()` / `.single()`:

```ts
interface CalendarRow {
  id: string;
  calendar_id: string;
  name: string;
  slug: string;
  description: string | null;
  external_url: string | null;
}

const { data: calendar } = await supabase
  .from('calendars')
  .select('id, calendar_id, name, slug, description, external_url')
  .or(`slug.eq.${slug},calendar_id.eq.${slug}`)
  .eq('is_active', true)
  .eq('visibility', 'public')
  .maybeSingle<CalendarRow>();

if (!calendar) return new NextResponse('Not found', { status: 404 });

// Now `calendar.id`, `calendar.name`, etc. are typed without `as any` casts.
```

This is the right answer for one-off route handlers. For repeated row
shapes that flow through multiple files, define the interface once in
`@gatewaze/shared/types/...` and import.

**Existing fix:** `packages/portal/app/api/calendars/[slug]/feed.ics/route.ts`.

## Supabase `!inner` joins

Supabase types `!inner` joins as `T[]` even when the relation is
structurally 1:1. The generated row shape will surprise you:

```ts
.select(`
  is_primary,
  speaker:events_speakers!inner ( ... ),
  talk:events_talks!inner ( ... )
`)
// row.speaker is typed as Array<...>, not the single object you'd expect.
```

Two patterns that work:

**A. Cast through `unknown` to a local shape:**
```ts
type RawSpeakerTalk = {
  talk: { id: string; status?: string | null; ... }
      | Array<{ id: string; status?: string | null; ... }>;
};
const rows = (speakerTalks as unknown as RawSpeakerTalk[])
  .map((st) => (Array.isArray(st.talk) ? st.talk[0] : st.talk))
  .filter((t): t is NonNullable<typeof t> => Boolean(t));
```

**B. Unwrap defensively at the boundary:**
```ts
const profiles = (data as SpeakerRow).people_profiles;
const personProfile = (Array.isArray(profiles) ? profiles[0] : profiles) ?? null;
```

Both are present in the codebase. Pick A when the consumer expects a
flat shape; pick B when you're inside a function that already has a
typed parent object.

**Existing fixes:**
- `packages/portal/components/event/SpeakersPageContent.tsx`
- `packages/portal/components/event/TalksFormContent.tsx`
- `packages/portal/components/event/SpeakerEditContent.tsx`
- `packages/admin/src/app/pages/people/detail.tsx`

## The legitimate `: any` floor

Source-level `: any` count is 34 — all in admin polymorphic-erasure UI
components:

- `<E extends ElementType>` polymorphic component erasure (Accordion,
  Button, Badge, Card, Form/Input, Form/Textarea, Form/Swap, Form/
  Upload, ScrollShadow, PaginationControl, Avatar, Collapse, Datepicker)
- Headless UI render-prop value bags (StyledCombobox, StyledListbox)
- Flatpickr render-prop signatures
- Generic variadic hook constraints (useDebounceCallback `(...args: any[])`,
  useUncontrolled `...payload: any[]`, useCollapse `theirRef: any`)

Narrowing these breaks JSX inference at every call site (TypeScript
loses the polymorphic generic). The flat config at
`packages/admin/eslint.config.js` has `'@typescript-eslint/no-explicit-any':
'off'` for this reason — admin's any-count budget is intentionally
non-zero.

If you're tempted to add a new `: any`, first try:

1. The structural-builder pattern (`ListingQueryBuilder` in
   `packages/shared/src/listing/types.ts`) — define a minimal interface
   covering the methods you call, not the full upstream type.
2. Cast through `unknown` to a narrow local shape.
3. The Supabase generic at the call boundary (`.maybeSingle<RowShape>()`).
4. Generic constraint with explicit type param (`<T extends Foo>(x: T): T`).

If none of those work, add `// eslint-disable-next-line
@typescript-eslint/no-explicit-any -- <reason>` with a real
justification comment.

## Per-package tsconfig layout

The api package's `tsconfig.json` was previously `rootDir: src`, which
made every transitive `@gatewaze/shared` import trigger TS6059 ("not
under rootDir"). The fix landed in `packages/api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "rootDir": "../..",
    ...
  },
  "include": ["src", "test", "../../gatewaze.config.ts", "../shared/src"]
}
```

This mirrors `tsconfig.build.json` so `pnpm typecheck` sees the same
file set as `pnpm build`. Don't revert to `rootDir: src` — it would
re-introduce the 29 TS6059 errors.

The portal's `tsconfig.json` deliberately has NO `paths` mapping for
`/premium-gatewaze-modules/*` etc. Adding one resolves the auto-
generated registry's absolute-path imports to real files, which then
balloons the local TS error count by ~200 because TS recursively
compiles the external module sources. See `references/module-registry.md`.

## Catch blocks

ES2019 `catch {}` is preferred when the error binding is unread. eslint
has `'no-empty': ['error', { allowEmptyCatch: true }]` in admin and api
flat configs:

```ts
} catch {
  // Best-effort person lookup; missing or unreadable is fine.
}
```

Add a one-line comment so the empty body's intent is explicit. Don't
write `catch (error)` and ignore `error` — the unused-vars rule will
fire.

If you need to log the error: `catch (err) { logger.warn({ err }, '…') }`
or `catch (err) { console.error('[scope]', err) }`.

## Cast-through-`unknown` for narrow→wide assignments

When a helper returns a structural-narrow type but the call site has a
wider type (e.g. Supabase's full `PostgrestFilterBuilder`):

```ts
qb = applyFilters(qb, schema, filters, ctx) as unknown as typeof qb;
```

The `as unknown as` chain is acknowledged as a boundary cast. Don't
suppress with `as any` — the `unknown` narrows to a single intentional
boundary instead of an unbounded escape hatch.

**Pattern:** `packages/shared/src/listing/build-query.ts`. See
`references/listing-primitive.md`.

## Express namespace augmentation

The canonical pattern from `@types/express` requires `namespace
Express`, which trips `@typescript-eslint/no-namespace`. The eslint
config has the rule on, so add a per-line disable on the inner
`namespace` keyword (NOT on the `declare global` line — eslint reports
at the namespace declaration, not the wrapping global):

```ts
// Express's own type-augmentation contract requires `namespace Express`;
// this is the canonical pattern documented in @types/express.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: { id: string; name: string; scopes: string[]; ... };
    }
  }
}
```

**Existing fix:** `packages/api/src/lib/api-key-auth.ts`.
