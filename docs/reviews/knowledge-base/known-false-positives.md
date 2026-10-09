# Known false positives

Patterns that look dangerous on this codebase and are confirmed safe. Applied
**last**, after every other check — a match here drops the finding even when
another entry would otherwise fire.

Several of these were established by direct empirical test rather than by reading.
Where that is the case it is stated, because the test is the reason the entry can be
trusted.

**Read when:** always.

---

## Confirmed safe by direct test

**Cross-origin redirect does not leak an `Authorization` header.** Confirmed
2026-07-31 on Node v22.20.0 with global `fetch`/undici: "on `redirect: 'follow'`, an
`Authorization` header IS stripped automatically when the redirect target is a
different origin (scheme+host+port), and IS preserved when the redirect stays
same-origin. This is spec-compliant fetch behavior, not app code." So a PAT attached
only for a specific allowlisted host "cannot be exfiltrated to an attacker host
purely via a cross-origin 3xx". **Do not flag "token header + `redirect: 'follow'`"
as an automatic exfiltration vector.** This does not excuse the SSRF risk — the
header stripping protects the *token*, not the *destination allowlist*, which fetch
never re-checks. See
`network-and-resource-limits/allowlist-not-rechecked-across-redirect`.

**Two `.or()` calls on one PostgREST query AND together.** Confirmed 2026-09-10 by
reading `PostgrestFilterBuilder.or()` directly
(`@supabase/postgrest-js/dist/cjs/PostgrestFilterBuilder.js`): it appends a second
`or=` query-string key via `searchParams.append`, and PostgREST ANDs repeated
same-name params. So `query.or(A).or(B)` is always `(A) AND (B)` — "never `(A) OR
(B)` and never 'B replaces A'". Practical consequence: a later `.or()` added
downstream (a keyset-pagination cursor) **cannot widen** a tenancy filter applied
earlier in the same chain. Do not flag a second `.or()` as a visibility-widening
risk.

---

## Confirmed safe by construction

**`resolveSharedImports`'s `[\w.-]+\.ts` regex.** Looks like it permits
dot-traversal filenames. It excludes `/`, so standard `../` traversal is blocked, and
`path.join` does not treat `....ts` as a traversal sequence — only a bare `..`
segment resolves to the parent.

**`serviceRoleKey` passed to a Supabase client.** This is the expected usage pattern
for server-side service-role auth, not a leak. The service-role key is also used as
the Bearer token for edge-function invocation in the invoke-function proxy and is
never returned to clients.

**`verify_jwt: false` in `cloud-api.ts` deploy metadata.** Intentional — module edge
functions do their own auth via Supabase RLS rather than at the edge layer. Related:
`docker-compose.yml` defaults `VERIFY_JWT` to false for local dev, while
`docker-compose.quickstart.yml` defaults it to true.

**Bare `import.meta.env.VITE_X` in `packages/admin/src/**`.** A bare member
expression with no optional chaining and no destructuring is **required**, not sloppy
code. `vite.config.ts`'s `buildRuntimeConfigDefine()` rewrites
`import.meta.env.VITE_X` to `globalThis.__GATEWAZE_CONFIG__.VITE_X` via esbuild
`define`, which only matches the literal member-expression string verbatim. Optional
chaining or destructuring the env object "would silently skip the rewrite and always
read Vite's build-time-inlined value (usually `undefined` in the per-brand
runtime-config image) instead of the pod's real runtime value." Confirmed correct
usage 2026-08-06 in `ModuleUpdateBanner.tsx`.

**Hardcoded `node_modules/<pkg>/dist/**.mjs` paths in `packages/admin/vite.config.ts`
`resolve.alias`.** Deliberate pinning (e.g. `@react-email/render` → its `dist`
build), not an accidental absolute path.

**RLS enabled with no policy on a `gatewaze_module_writer`-owned table.** Intentional
and is the `content-platform` convention, not a gap — the table owner is the same
role the SECURITY DEFINER functions run as, so the owner's natural RLS bypass is the
only read/write path, and `service_role` bypasses RLS separately. See
`rls-and-postgrest/security-definer-convention`.

**Conditional `.select()` field lists built from a `useHasModule()` boolean.** String
concatenation into a select list is not an injection surface when every component is
a literal chosen by a boolean, never request input. Confirmed on
`EmailHistorySection.tsx` (2026-08-04).

**Unquoted `assign_root $TARGET` word-splitting.** Intentional two-token split, and
safe because `TARGET` can only ever be one of four closed-set strings — the Python
building it validates with `re.fullmatch` and gates the literal `" reassert"` suffix
on `d.get("reassert") is True` (strict boolean identity, not truthy) before either
token can exist.

**Unquoted `for q in $(lsof -tnP ...)` word-splitting** in
`primary_restart_worktree_app` / `primary_restart_mainline_app`. Safe because
`lsof -t` only ever emits whitespace-separated numeric pids, never attacker-shaped
text.

**`case "$cwd" in "$PRIMARY_APP_WT"|...)` glob patterns.** `case` patterns are globs,
but the variables here are fixed constants built from `$LFX`/`$APP_REPO`, never
request data — so the glob semantics are not exploitable. This is the *inverse* of
`input-validation-and-injection/independent-revalidation-convention`, where the same
glob-vs-regex distinction did matter because the value was registry-sourced. Check
the value's origin before deciding which applies.

---

## Known-intentional, tracked elsewhere

**`EDGE_FUNCTIONS_CONTAINER` used unsanitized in a Docker socket path.** Local dev
only.

**`CORS_ORIGIN` unset defaults to reflect-origin.** Dev-mode behavior; not configured
in the Helm chart's `values.yaml`.

**`integration_events` has no RLS and no visible GRANT restrictions.** Background-service
only, accessed via the service role.

**`allow-same-origin` on the arcade iframe sandbox.** Deliberate and locked in by
`app-block.test.ts` — it is load-bearing for `ArcadeBridge`'s `event.origin` check,
because a sandboxed frame without it posts with `event.origin === 'null'`. This is
**not** a clean pass: it is tracked as a HARD finding (all games share one
`ARCADE_PLAY_ORIGIN`, so `allow-same-origin` grants each game access to every other
game's storage). Listed here only so the sandbox attribute is not re-flagged as an
oversight — it is a known, tracked tradeoff. Re-check whether the arcade module has
since given each game a distinct origin.

---

## Reference-quality implementations — do not flag, do reuse

**`ArcadeBridge.tsx`'s postMessage handling** (2026-08-03). The host-side filter
checks `event.origin` against an exact configured origin (never a prefix or suffix
match) **and** `event.source === candidate.contentWindow` (per-iframe Window
identity, unforgeable) **and** a per-frame random nonce echoed on every message after
the handshake. `postMessage` always targets the parsed exact origin, never `'*'`. The
minted token lives only in a closure variable, never storage, and is nulled on
cleanup. `arcade:request-signin` builds its redirect purely from
`window.location.pathname`, never from `event.data` — so it is not an open redirect
despite looking like one.

**The doubled-gate convention on `/test-env/*` mutating routes.** Router-level
`ADMIN_ROLES` check plus a per-route `requireSuperAdminBearer()` requiring a literal
`Authorization: Bearer` header — CSRF hardening, because cookie auth alone is not
sufficient for a destructive action. Dedicated tests lock in that each new flag does
not bypass the escalation.

**`lib/env-events.ts`'s JSONL ingest.** Treats every line as hostile even though the
file is host-agent-written: shape gates, `MAX_LINE_BYTES` (8192),
`MAX_LINES_PER_INGEST` (500), `MAX_DETAIL` (2000, control chars stripped),
`MAX_META_JSON` (2000) — all enforced before a row reaches `insert()`, and a
malformed line is skipped rather than stalling the cursor.

**`lib/env-events-query.ts`.** The reference for `.or()` safety: every raw query param
is turned into a value with a proven shape before it reaches PostgREST, and the test
suite exercises adversarial payloads directly (labels with an injected paren or
comma, a half cursor, a non-numeric id, `"x,or(ts.gt.2000-01-01)"` in the search box).
