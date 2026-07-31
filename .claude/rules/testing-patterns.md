---
paths: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**", "e2e/**", "tests/**"]
source: gatewaze-skills/production-readiness/references/testing-patterns.md
---

# Testing patterns

## Stack per package

- **admin** — vitest + @testing-library/react. Tests live in `src/**/__tests__/*.test.ts(x)`. Setup at `src/test/setup.ts` (jsdom, mocks).
- **api** — vitest + supertest. Tests live in `src/**/__tests__/*.test.ts`. Mock supabase at `test/mock-supabase.ts`. Integration tests at `test/integration/*.integration.test.ts` (require `SUPABASE_INTEGRATION=1` env + real Supabase).
- **portal** — vitest. Tests live in `lib/**/__tests__/*.test.ts(x)`. Setup at `test/setup.ts`.
- **shared** — vitest. Tests live in `src/**/__tests__/*.test.ts`.

Run per-package: `pnpm --filter @gatewaze/<pkg> test`.

## Pre-existing failure protocol

If a test fails locally and you didn't think your change touched it:

```bash
git stash
pnpm --filter @gatewaze/<pkg> test 2>&1 | grep -E 'FAIL|×' | head
# … (pre-existence check) …
git checkout -- packages/<pkg>/tsconfig.tsbuildinfo  # if needed
git stash pop
```

If the test fails on the parent commit too, it's pre-existing. Two
canonical ones the prod-hardening pass surfaced:

1. **shared `formatDate` "formats a Date object"** — used `new
   Date('2024-01-01T00:00:00Z')` (midnight UTC) which renders as `Dec
   31, 2023` in PST. Switched the test to `2024-01-01T12:00:00Z`
   (noon UTC) so timezone shifts can't roll the date across midnight.
   See `packages/shared/src/utils/__tests__/index.test.ts`.

2. **api `health.test.ts`** — locked status to exactly `'ok'`, but the
   legacy `/api/health` endpoint intentionally returns `'degraded'`
   when the queue isn't configured. Loosened to `['ok',
   'degraded'].toContain(...)`. The dedicated `/health/live` and
   `/health/ready` probes are the strict ones.

3. **api `people.test.ts`** — the response shape was changed to
   include HATEOAS `_links.self`; the old assertion was `toEqual(bare
   shape)`. Switched to `toMatchObject(domainFields)` plus a separate
   assertion on `_links.self.href`.

When you fix a pre-existing failure, the commit body should explicitly
say "this is pre-existing — confirmed via git-stash compare" so
reviewers don't assume your change caused it.

## Regression tests for security boundaries

Every security boundary fix gets a test. Three patterns we used:

### Mock-supabase `or` call inspection

For PostgREST filter sanitisation, mock the supabase client and
inspect the `.or()` call argument:

```ts
it('strips PostgREST filter metacharacters from search', async () => {
  mockSupabase.mockResult([], null, 0);
  await request(app).get('/api/people?search=' + encodeURIComponent('jane,id.gt.0(*\\)'));

  const orArg = mockSupabase.client.or.mock.calls[0]?.[0] as string;
  expect(orArg).toBeDefined();
  expect(orArg).toContain('%janeid.gt.0%');  // sanitised value made it through
  expect(orArg).not.toContain('%jane,');     // injection signature stripped
  expect(orArg).not.toContain('(*');
  expect(orArg).not.toContain('\\)');
});
```

Note: don't assert `.not.toMatch(/[,()*\\]/g)` on the whole or-string —
the .or() filter scaffolding legitimately uses commas as separators.
Look for the injection signature inside the `%...%` ilike pattern.

See `packages/api/src/routes/__tests__/people.test.ts`.

### Direct unit test for an extracted helper

For ICS helpers, RFC-5545 escape rules, etc., extract the helper to its
own module and test it directly:

```ts
// packages/portal/lib/__tests__/ics-helpers.test.ts
import { escapeICSText, sanitizeICSLineValue } from '../ics-helpers';

describe('sanitizeICSLineValue', () => {
  it('strips CR and LF — the actual injection vectors', () => {
    expect(sanitizeICSLineValue('https://evil\r\nURL:bad')).toBe('https://evilURL:bad');
    expect(sanitizeICSLineValue('a\rb\nc')).toBe('abc');
  });
  // ... per-character-class tests
});
```

This is the canonical pattern for security-sensitive helpers — the
test file pins each rule with a one-purpose `it(...)` so a future
refactor can't silently regress one rule while fixing another.

### Integration test (skipped without real Supabase)

For end-to-end auth/RLS/tenancy assertions, the api package has
integration tests at `packages/api/test/integration/*.integration.test.ts`.
They use `describeIfIntegration = integrationEnabled ? describe :
describe.skip` and only run when `SUPABASE_INTEGRATION=1` env is set.

Don't try to run these without a real Supabase. They're operator-
gated and gated correctly.

## What NOT to test

- **Don't test the framework.** A test that mounts a button and
  asserts `expect(button).toBeInTheDocument()` doesn't add value if
  the same expectation is already typed via `useRef<HTMLButtonElement>`.
- **Don't test internal implementation details.** Test the contract,
  not the wiring. A test that asserts `mockSupabase.client.from` was
  called with `'people'` is okay; one that asserts the order of
  `.eq()` chain calls is brittle.
- **Don't test for the absence of a TS error.** If the type system
  guarantees something, it doesn't need a runtime test.

## Every feature ships with tests (non-negotiable)

This is rule 9 in the SKILL.md. The minimum bar is one happy-path
test plus one test per validation rule, security boundary, or
4xx/5xx code path the feature introduces.

A bug fix without a regression test is a half-fix — the next
refactor will silently re-introduce the bug. The regression test is
the evidence that the fix is durable.

### Per-layer recipe

**API route (`packages/api/src/routes/<route>.ts`):**

Test file: `packages/api/src/routes/__tests__/<route>.test.ts`. Follow
the supertest + mock-supabase pattern from `people.test.ts`:

- `it('returns happy path 200 with expected shape')` — assert status
  + key fields on the response body. Use `toMatchObject` for objects
  with HATEOAS additions (`_links.self`).
- `it('returns 4xx when <required field> is missing')` — one test per
  required field.
- `it('returns 4xx when <field> has invalid format')` — one test per
  validated field.
- `it('strips PostgREST filter metacharacters from <field>')` if the
  route interpolates user input into `.or()`. See `people.test.ts`'s
  injection-guard test for the assertion pattern.
- `it('returns 401 when no JWT is present')` — already covered by
  the generic `auth-coverage.test.ts` for JWT-gated routes; you
  don't need to repeat per-route.
- `it('returns 503 when supabase is null')` if the route accepts
  `SupabaseClient | null`.
- `it('returns 500 with error envelope on DB failure')` — assert
  the `{ error: { code, message } }` shape.

**Portal route handler (`packages/portal/app/api/<route>/route.ts`):**

Portal route handlers don't yet have a route-level test harness. If
you're adding a new route, also add the harness:

1. Use vitest's mock for next/server (the route handler imports
   `NextRequest, NextResponse` from there).
2. Follow the api package's pattern — mock `getSupabase` /
   `getServiceSupabase`, drive the route via `request(app)` style.
3. Add the test file at `packages/portal/app/api/<route>/__tests__/
   route.test.ts`.

If adding the harness is too big for the feature you're shipping,
extract the route's pure logic (validation, sanitisation,
transformation) into a sibling module and unit-test that — like
`ics-helpers.ts` for `feed.ics/route.ts`. The route handler then
becomes a thin shim over tested helpers.

**Admin component (`packages/admin/src/**/*.tsx`):**

Use vitest + @testing-library/react. Setup is at `src/test/setup.ts`
(jsdom + mocks for next/navigation, next/image, react-router).

Per component, the test file lives next to it as
`<Component>.test.tsx`:

- `it('renders happy path with expected DOM')` — the shape, not
  every detail. Use `screen.getByRole`, `getByText`, etc.
- `it('handles <user interaction>')` — typing, clicking, etc., via
  `@testing-library/user-event`.
- `it('shows loading state when isLoading')` — covers the
  conditional render branches.
- `it('shows error state when error')` — same for error branches.
- `it('disables submit when form invalid')` — for forms.

For pure functions extracted from a component (validators,
formatters, computed selectors), write a separate `.test.ts` and
test the helper directly — much faster and doesn't need jsdom.

**Portal component (`packages/portal/components/**/*.tsx`):**

Same patterns as admin. Setup at `packages/portal/test/setup.ts`.

**Shared utility (`packages/shared/src/**/*.ts`):**

Pure unit tests in `__tests__/<helper>.test.ts`. The shared package
already has the highest test ratio (53 tests for ~2.5k LOC); keep
that ratio for new additions.

### What "ships with tests" doesn't mean

- It doesn't mean "100% coverage of every line." Test the contract,
  not the implementation.
- It doesn't mean "test the framework." Don't write a test that
  verifies React renders a div, or that Express returns 200 on a
  bare handler.
- It doesn't mean "test every TypeScript-guaranteed property." If
  the type system proves a field exists, you don't need a runtime
  check.

### When skipping a test is acceptable

Only when ALL of these are true:

1. The change is a pure data refactor with no behaviour change (a
   rename, an unused-import drop, a field reorder) — and the
   compiler proves the equivalence.
2. The change is to documentation, comments, or commit-only
   metadata.
3. The behaviour the test would cover is already covered by an
   existing test that touches the same code path.

In any of those cases, say so in the commit body explicitly so a
reviewer doesn't have to guess: "no new test — pure refactor of X
field, behaviour covered by existing `<test-file>:<test-name>`."

### Bug fixes always get a regression test

When fixing a bug, the test goes in BEFORE the fix:

1. Write the test that reproduces the bug. It fails.
2. Apply the fix. The test passes.
3. Commit both together with a body that says what the bug was and
   how the test pins it.

Two examples from the prod-hardening pass:

- The PostgREST search-injection guard in `people.ts` got a regression
  test that asserts the `.or()` string after sanitisation lacks the
  injection signature. See `people.test.ts:'strips PostgREST filter
  metacharacters from search'`.
- The latent `foldLine` off-by-2 bug was found by writing a
  round-trip test for the helper, not by reading the code. See
  `ics-helpers.test.ts:'folds lines longer than 75 octets with
  single-space continuation'`.

## Test runner expectations

| Package | Tests | Skipped |
|---------|------:|--------:|
| admin | 29 | 0 |
| api | 66 | 13 (integration, require SUPABASE_INTEGRATION=1) |
| portal | 59 | 0 |
| shared | 53 | 0 |

If your change drops one of these counts without explanation, that's
a regression.
