# Module route authorization

The highest-frequency finding class in this codebase. Modules mount their own
Express routers, and the platform applies no auth to them — so every module has
to gate itself, and the ones that forget are reachable unauthenticated.

**Read when:** any `api/register-routes.ts`, `api/admin-routes.ts`,
`packages/api/src/routes/**`, or any new route or router mount.

---

## `module-route-authz/mount-prefix-is-not-auth` — HARD

**Pattern:** a module assumes that being mounted under `/api/modules/<id>` means
the platform's JWT middleware already ran, and therefore ships routes with no
auth check of its own. Sometimes the assumption is written down in a code comment,
which makes it look verified.

**Detect:** for every module router, find an explicit `router.use(requireJwt())`
or equivalent auth middleware *inside the route file*. Its absence is the finding.
Do not accept as evidence: the `/api/modules/` mount prefix, a `labelMountPrefix()`
/ `mountLabeled()` call, a `// platform JWT runs first` comment, or DB-level RLS
that is `service_role`-only.

**Empirical citation:** established 2026-07-30 during the `vehicle-video` review:
"`labelMountPrefix()`/`mountLabeled()` in `packages/api/src/lib/router-registry.ts`
are BOOKKEEPING ONLY for the boot-time `assertAllRoutesLabeled()` self-check —
they do not attach `requireJwt()` or any other enforcement middleware… a module
author who assumes 'the platform's `/api/modules/<id>` prefix runs the upstream
JWT middleware first' (a claim seen verbatim in a module's own code comment) is
wrong." `vehicle-video` had "zero application-layer auth on any route", its RLS
was service-role-only and "explicitly defers gating to 'the route layer,' which
provides none". Recurred in `software-engineer/api/admin-routes.ts` (2026-07-31,
carrying its own `// SECURITY TODO (prod hardening)` comment) and again in
`modules/ai` (2026-09-05).

**Failure message:** Module router has no application-layer auth — every route is
reachable unauthenticated. The mount prefix is bookkeeping, not enforcement.

**Fix:** add an explicit auth middleware inside the route file before any route is
registered. Where the module has admin surfaces, use the doubled gate described in
`module-route-authz/new-mutating-route-skips-house-gate`.

---

## `module-route-authz/sibling-router-gated-this-one-is-not` — HARD

**Pattern:** a module builds two routers. One gets auth middleware; the other,
usually the larger one, is mounted separately with none. The module's authors
clearly know the correct pattern — they just did not apply it uniformly.

**Detect:** grep the module for every `app.use(` / `router.use(` mount. For each,
walk back to the router's construction and list the middleware attached. Any two
routers in the same module with materially different auth chains is the finding
unless a comment explains why one is deliberately public.

**Empirical citation:** `modules/ai` (2026-09-05, branch `feat/ai-cost-unification`,
HARD, unauthenticated): "`register-routes.ts` builds a SEPARATE router
(`adminContentRouter`) that DOES run a `decodeJwt` middleware + downstream
`admin_profiles` role check … But the much larger `router` — ALL of
`admin-routes.ts`: threads, use-cases, every credential CRUD route … is mounted
separately (`app.use('/api/modules/ai', router)`) with ZERO auth middleware
anywhere in the chain." Consequence: an unauthenticated caller could enumerate a
credential id via the unauthenticated GET and then rotate its secret, hijacking
which provider account served all future LLM calls platform-wide.

**Failure message:** A sibling router in this module is auth-gated and this one is
not. The pattern exists in-file and was not applied here.

**Fix:** apply the module's own gated-router pattern to the ungated router, or
merge the two routers so there is one chain to reason about.

---

## `module-route-authz/new-mutating-route-skips-house-gate` — HARD

**Pattern:** a file establishes a gate convention for its mutating routes — in
`software-engineer/api/admin-routes.ts`, the router-level `ADMIN_ROLES` check
*plus* an explicit `requireSuperAdminBearer()` / `Authorization: Bearer` check for
CSRF hardening. A newly added mutating route picks up the router-level gate
automatically and silently misses the explicit one.

**Detect:** list every mutating route (POST/PATCH/DELETE) in the file and diff the
per-route gate calls. A new route whose gate set is a strict subset of its
siblings' is the finding. Check gate *ordering* too: the house sequence is auth →
param validation → business precondition.

**Empirical citation:** `software-engineer/lib/clarity.ts` + `admin-routes.ts`
(2026-08-23): "`POST /test-env/clarity/refresh` was the only mutating route added
to this file that skipped the established doubled-gate convention … it had the
router-level `ADMIN_ROLES` check but no explicit-Bearer requirement, unlike every
sibling mutating `/test-env/*` route in the same file." Because `force: true` spent
from a hard 10-calls/day quota, a cookie-only forged request could burn the whole
day's budget. The same entry records: "this is now the **second time** a new route
type has needed it pointed out rather than being applied by default from the
file's own established convention."

**Failure message:** New mutating route carries fewer gates than every sibling
mutating route in this file.

**Fix:** match the sibling gate set and ordering. Where the new route is genuinely
lower-stakes, apply the lighter gate deliberately and say so in a comment — the
Clarity fix used the explicit-Bearer CSRF check without the full super-admin
escalation, and recorded why.

---

## `module-route-authz/role-gate-missing-on-mutating-router` — HARD

**Pattern:** a mutating router is guarded by middleware that looks like
authorization but is not. `requireJwt()` proves the caller is *some* authenticated
user; `requireLeadership()` checks which API pod is the singleton writer, not a
user permission.

**Detect:** for each guard on a mutating router, read its implementation and ask
what it actually asserts. Flag any mutating router whose chain contains no check
of `gatewaze_role` / `admin_profiles` role.

**Empirical citation:** `packages/api/src/routes/modules.ts` (confirmed 2026-08-27):
"`modulesRouter` has NO role/admin check anywhere in the file — only `requireJwt()`
(any authenticated user of any account) + `requireLeadership` (checks `isLeader()`,
i.e. which API pod is the singleton writer, NOT a user permission gate)… apply-update,
update-all, sources/refresh, upload, enable/disable all reachable by any
authenticated user, not just admins." Compounding: LFID SSO self-mints real
Supabase sessions for ordinary portal members, so "authenticated" includes the
general community, not just staff.

**Failure message:** Mutating router has authentication but no authorization — any
authenticated user can reach it.

**Fix:** add an explicit role check. When triaging any other finding on such a
router, raise its severity accordingly: the attacker model is every authenticated
user, not an admin.

---

## `module-route-authz/marker-presence-trusted-without-applier` — HARD

**Pattern:** code changes behavior based on the presence of an external marker — a
GitHub label, a header, a webhook field — without checking *who* set it. The
permission to set the marker is usually far broader than the permission the marker
grants.

**Detect:** for every read of an external marker that changes control flow (skips a
phase, skips a gate, changes routing), find the applier-identity check. In this
codebase the reference implementation is in
`software-engineer/workers/intake.ts`: re-derive the applier via
`gh.listIssueEvents()` (last `labeled` event per label wins) and honor it only when
`allowedLabellers.includes(login) || login === run.labeller`. A fetch failure must
fail closed.

**Empirical citation:** the convention is stated in the security patterns for
`intake.ts`: "GitHub label-write (triage role) is a much broader set than
`project.allowedLabellers`… Any FUTURE label read off the issue in this file that
changes run behavior (skip a phase, skip a gate, change routing) should be held to
this same applier-verification standard." It was then violated ~30 lines away in
the same file (2026-08-22, HARD): the new `agent:spec:provided`/`agent:spec:approved`
handling "trusts label PRESENCE alone … with NO applier-identity check", letting any
user with triage permission "skip spec-authoring, skip the adversarial self-review
phase, skip the `awaiting_spec` human gate entirely" and feed attacker-supplied
issue-body content into an autonomous coding agent that writes and pushes code.
The docs added in the same diff *asserted* parity with the override-label trust
model that the code did not implement. Resolved same-day.

**Failure message:** Marker presence changes behavior with no applier-identity
check, while a sibling marker in the same file verifies its applier.

**Fix:** resolve the specific marker's applier and gate on the allowlist, exactly
as the sibling block does. Treat an untrusted applier as "marker not present" and
fall through to the gated path — not as a hard failure.

---

## `module-route-authz/branch-asymmetry-in-one-handler` — HARD

**Pattern:** a handler has two branches that reach the same privileged effect, and
only one of them carries the precondition check.

**Detect:** for any handler with a branch on a request-supplied discriminator,
tabulate the checks each branch performs before the shared effect. Any check
present in one branch and absent in the other is the finding.

**Empirical citation:** `event-speakers/functions/events-speaker-confirm/index.ts`
(2026-08-07, HARD): "The cross-event branch (`if (targetEventId)`) never checks
`talk.status`, unlike the same-event branch (line 378 checks `status !== 'approved'`).
Any holder of a talk's `confirmation_token` — regardless of whether that talk is
`pending`/`rejected`/`reserve`… — can hit `?token=<t>&event_id=<any public 6-char
event id>` and instantly get INSERTed as a `confirmed` speaker … on ANY event on
the platform." Compounded by
`rls-and-postgrest/anon-select-exposes-capability-token`.

**Failure message:** One branch of this handler enforces a precondition the other
branch reaching the same effect does not.

**Fix:** hoist the check above the branch, or replicate it. Where the branch is
driven by a client-supplied target, prefer binding the permitted target
server-side at token-issue time and validating the request against it.

---

## `module-route-authz/jwt-decoded-not-verified` — HARD

**Pattern:** a helper named like a verifier parses a JWT payload without checking
the signature, usually with a comment claiming verification happens upstream. It
becomes a forge-any-user primitive for every route that trusts its output.

**Detect:** grep for JWT handling that reaches `Buffer.from(...).toString()` /
`atob` / a manual `split('.')` with no signature verification call. Then check
whether the claimed upstream verification actually exists — in this platform it
does not (`packages/api/src/server.ts` passes a raw Express `app` with no auth
applied first).

**Empirical citation:** `modules/ai/api/register-routes.ts` (2026-09-05): "`decodeJwt`
parses the JWT payload via `Buffer.from(...).toString()` with NO signature
verification, despite a comment claiming 'signature verification is upstream' (per
the platform's confirmed behavior, there is none) — a forge-any-user_id primitive
against whichever routes DO sit behind `adminContentRouter`/`requireAdmin`." The
entry closes with the instruction that matters here: "Don't let a future fix for
the `router` gap copy this same decode-and-trust helper."

**Failure message:** JWT is decoded but never verified; the comment claiming
upstream verification is false for this platform.

**Fix:** verify the signature against the Supabase JWT secret / JWKS before
trusting any claim. When fixing an adjacent auth gap, do not reuse this helper.
