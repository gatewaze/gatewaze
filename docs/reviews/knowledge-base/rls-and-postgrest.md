# RLS and PostgREST

Postgres row-level security composes in ways that make a migration safe in
isolation and unsafe in place. Supabase's default grants widen every new column
automatically. Both have produced real exposure here.

**Read when:** any `migrations/*.sql`, `supabase/migrations/**`, or any `.or()` /
PostgREST query-builder use.

---

## `rls-and-postgrest/permissive-policy-never-dropped` — HARD

**Pattern:** a later migration adds a stricter SELECT policy intended to replace an
earlier permissive one, but never drops the old policy. Postgres RLS SELECT
policies are **permissive and OR'd by default**, so the loose policy still grants
access and the stricter one is decorative.

**Detect:** when a migration adds a policy to an existing table, grep every prior
migration for policies on that same table and action. Two SELECT policies means the
union applies. Confirm the intent: a policy named like a tightening
(`*_admin_read`) alongside a `USING (true)` is the signature.

**Empirical citation:** flagged 2026-08-27: "`installed_modules` RLS
(`supabase/migrations/00006_rls_policies.sql:440`
`authenticated_select_installed_modules`, `USING (true)` for role `authenticated`)
was never dropped when `00020_module_system_v1_1.sql:244` added the
intended-to-be-stricter `installed_modules_admin_read` policy… the old policy still
grants full-column SELECT (including `reconcile_error`, which carries raw
unredacted Postgres error text + filesystem paths from migration failures) to ANY
authenticated Supabase user." The entry also notes the second-order trap it was
found by: an unrelated redaction fix had been justified on the assumption that
`reconcile_error` was admin-only. "No pgTAP test covers `installed_modules` RLS."

**Failure message:** A permissive policy from an earlier migration still applies —
the stricter policy added here does not replace it.

**Fix:** `DROP POLICY` the old one, or add a RESTRICTIVE policy (which ANDs rather
than ORs). Add a pgTAP test pinning the intended access, since nothing else will
catch the regression.

---

## `rls-and-postgrest/supabase-default-grant-widens-new-columns` — HARD

**Pattern:** a module enables RLS and adds `USING (true)` policies for `anon` /
`authenticated` without column-level grants. Because Supabase's default
`GRANT ALL ON TABLES` to those roles remains in force, **every column added to that
table later** is automatically world-readable — including columns added by a
migration that looks entirely additive and safe.

**Detect:** before calling any additive migration low-risk, read the target table's
existing policies and grants. A `USING (true)` policy plus no `REVOKE`/column-level
`GRANT` means the new column inherits full exposure.

**Empirical citation:** reconfirmed 2026-08-07 on `modules/event-speakers`: "a
module's migrations enable RLS and add `USING (true)` policies for
`anon`/`authenticated` without ever granting/revoking at the column level, so ANY
column added to that table later (e.g. migration 019's `confirmed_at` etc.) is
automatically world-readable via the anon key too. When reviewing a new 'additive,
all `IF NOT EXISTS`' migration, always check the target table's existing RLS
policies before calling the migration itself low-risk — the migration can be
perfectly safe in isolation while still widening a real exposure." Same shape
previously recorded for `platform_settings` (`USING(true)`, fully public) and
`integration_events`.

**Failure message:** New column lands on a table with a `USING (true)` policy and
table-level grants — it is readable with the anon key.

**Fix:** grant column-level SELECT instead of table-level, or move the sensitive
column behind a view or SECURITY DEFINER RPC. Tighten the policy predicate if
`USING (true)` was never intended.

---

## `rls-and-postgrest/anon-select-exposes-capability-token` — HARD

**Pattern:** a column holding a capability token — a confirmation token, an
invite code, an unsubscribe key — is readable through an `anon` SELECT policy or a
granted view. The token is treated as a secret by the code that checks it and is
published by the schema that stores it, so it can be harvested in bulk rather than
guessed.

**Detect:** for every column whose value gates an action, trace read access: table
policies, view grants, and any `select('*')` that reaches a client. `select('*')`
is the easy one to miss — a column-level review of the policy will not show it.

**Empirical citation:** `modules/event-speakers` (2026-08-07, HARD): "`confirmation_token`
itself is NOT secret: migration 001's `anon_read_events_talks ON events_talks FOR
SELECT TO anon USING (true)` … and migration 013's `events_speakers_with_details`
view (`GRANT SELECT … TO anon`) both expose `confirmation_token` in plaintext to
any caller with just the public anon key — no email interception needed, tokens can
be harvested in bulk." Combined with the branch-asymmetry finding in the same
module: "unauthenticated, zero-token-guessing mass self-enrollment as a 'confirmed'
speaker on any event." A sibling instance in `health-menopause` (2026-09-11,
unresolved) leaked `hm_red_flags`/`hm_escalation_copy.tier` "via raw `select('*')`
in `export-build.ts` and `GET /admin/escalation-copy`", and the memory notes it was
"invisible to the source-grep tier test" — the guard test grepped for the column
name, and `*` does not contain it.

**Failure message:** Capability token is readable via anon SELECT or a wildcard
select — it can be harvested, not just intercepted.

**Fix:** revoke anon SELECT on the column, split it out of any granted view, or
move the check behind a SECURITY DEFINER RPC. Replace `select('*')` with an
explicit column list on any path that reaches a client, and make the guard test
assert the returned shape rather than grepping source for a column name.

---

## `rls-and-postgrest/or-filter-string-interpolation` — SHOULD

**Pattern:** a user-supplied value is interpolated into a PostgREST `.or()` filter
string. Unlike the query builder's typed methods, `.or()` takes raw filter syntax,
so an unsanitized value can at minimum produce malformed filters and at worst
restructure the predicate.

**Detect:** grep for `.or(` with a template literal. For each, trace the
interpolated value to its source and find the sanitizer. The reference
implementation is `software-engineer/lib/env-events-query.ts`: shape-gate every
param before it reaches the query, and run free text through a `sanitizeSearch()`
that strips `% * \ , ( ) " ' \``.

**Empirical citation:** `packages/api/src/routes/people.ts:27-29` and
`redirects.ts:111` (2026-04-29): "search query param interpolated into `.or()`
PostgREST filter (both JWT-gated; ilike-only, no operator injection, but malformed
filter syntax reachable)". `feed.ics` carries the same shape with raw slug
interpolation — safe only because "`.eq('visibility','public')` is a separate AND
clause". The clean reference is recorded for `feat/env-log-explorer` (2026-08-23):
"`ENV_LABEL_SHAPE` … has no comma, paren, quote, or dot, so a label cannot close
the `.in.(...)` list early", with adversarial payloads unit-tested.

**Failure message:** User input reaches a `.or()` filter string without shape
validation or sanitization.

**Fix:** prefer the typed query builder. Where `.or()` is genuinely needed,
shape-gate structured params with a regex that excludes `,` `(` `)` `"` `'` and
sanitize free text before it becomes an `ilike` pattern. Unit-test the adversarial
inputs.

---

## `rls-and-postgrest/security-definer-convention` — SHOULD

**Pattern:** a new `SECURITY DEFINER` function that does not follow the house
convention is either over-granted or vulnerable to search-path manipulation.

**Detect:** every definer function must pin `SET search_path = public, pg_temp`, be
owned by `gatewaze_module_writer` (the module's dedicated NOLOGIN role), and follow
`REVOKE ALL … FROM PUBLIC` with an explicit `GRANT EXECUTE` to only the roles that
need it — usually `service_role`, plus `anon, authenticated` for read-only boolean
helpers meant to run inside RLS `USING` clauses.

**Empirical citation:** established on `modules/content-platform` migrations 001 and
008, reviewed 2026-08-18 with no deviations. The same entry records a deliberate
non-gap worth not flagging: "Tables get `ENABLE ROW LEVEL SECURITY` with NO policy
and NO `FORCE ROW LEVEL SECURITY` — this is intentional, not a gap: the table owner
is `gatewaze_module_writer`, the same role the SECURITY DEFINER functions run as, so
the owner's natural RLS bypass is the only read/write path." Late-binding an optional
cross-module dependency via `to_regprocedure('public.<fn>(<types>)')` with a
hardcoded schema-qualified literal is the established pattern and is fail-open by
design when the dependency is absent.

**Failure message:** SECURITY DEFINER function deviates from the house convention
(search_path pin, owner role, REVOKE-then-GRANT).

**Fix:** match the `content-platform` migrations. Do not flag RLS-enabled-with-no-policy
on a `gatewaze_module_writer`-owned table — that is the convention, not a gap.
