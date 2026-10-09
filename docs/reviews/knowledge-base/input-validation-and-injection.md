# Input validation and injection

Where untrusted values reach a structured sink. The recurring shape here is not
classic SQL injection — it is a value that was validated for one purpose reaching a
serializer, a path, or a markup context that nobody checked.

**Read when:** any handler reading `req.body` / `req.params` / query params, or any
string interpolated into JSON, markdown, a URL path, or HTML.

---

## `input-validation-and-injection/untrusted-value-echoed-into-structured-sink` — HARD

**Pattern:** an untrusted value is rejected, and the rejection message embeds the
raw value. The message then flows into a sink that treats it as structure — a
hand-built JSON string, a markdown template, a shell-adjacent status file. The
validation succeeded and the echo defeated it.

**Detect:** for every error/status string built from a non-literal, follow where
that string goes. Any hand-serialized JSON (`printf '{"k":"%s"}'`), markdown
interpolation, or header write is a sink. Check the escaping at the sink, not at
the source.

**Empirical citation:** `gatewaze-environments/scripts/lfx-envlabel.py` (2026-08-23,
HARD): the "unknown repo" branch built `f"unknown repo {repo!r}"` before the repo
was checked against the alias table, and "Python `repr()` does not escape a bare `"`
when the string contains no `'` (verified empirically)". That message reached
`env_status()`'s `printf '{"state":"%s","detail":"%s",…}'` with no escaping, so a
crafted repo value "reliably overrides the on-disk `<label>.status.json`'s `state`
field via ordinary JSON duplicate-key/last-value-wins semantics." Notably, the same
function's three *other* raw-repo messages were not exploitable because by then the
value had already been confirmed against the alias table. Resolved in `042fcac` by
dropping the echo and building the status object with `json.dumps` instead of
`printf`. Same class in `software-engineer/api/admin-routes.ts:181-186`
(2026-07-31, HARD): a URL that passed a hostname allowlist was spliced raw into
`` `![screenshot-${i+1}](${u})` ``, and
`new URL("https://user-images.githubusercontent.com/abc.png) [pwned](https://evil.com/steal")`
parses with an allowlisted hostname — letting an attacker close the image syntax
and append arbitrary markdown to a GitHub issue created with the project PAT.

**Failure message:** Raw untrusted value is echoed into a message that reaches a
structured sink without escaping.

**Fix:** do not echo the raw value — use a fixed generic message. If the value must
be surfaced, serialize it properly at the sink (`json.dumps`, not `printf`). For
URLs, reject anything the parser had to normalize: `new URL(raw).href !== raw`.

---

## `input-validation-and-injection/enum-not-allowlisted-before-write` — SHOULD

**Pattern:** a value that must be one of a known set is written to the database or
passed downstream without being checked against that set. The type annotation says
it is a union; nothing enforces it at runtime.

**Detect:** for every DB write, list the fields whose domain is a union or enum and
find the runtime check. A TypeScript union type is not a check.

**Empirical citation:** `packages/portal/app/api/invite-rsvp/route.ts:235` and `:363`
(2026-04-29): "`rsvp_status` enum not allowlist-validated before DB write", same for
plus-one values. Same class in `vehicle-video/api/admin-routes.ts:275-293`
(2026-07-30): `mergeOverrides` "writes `body.style.{pacing,camera_energy,tone,accent}`
into `style_profile` with no enum allowlist (only `vehicle_character` is coerced)" —
lower severity there only because `voice` happened to be re-validated at TTS time
against `KNOWN_VOICES`.

**Failure message:** Union-typed field is written without a runtime allowlist check.

**Fix:** check against the literal set before the write. Where a downstream stage
re-validates, still validate here — the downstream check may not cover every field.

---

## `input-validation-and-injection/mass-assignment-via-req-body` — SHOULD

**Pattern:** `req.body` is spread directly into an insert or update, letting a
caller set any column the client-scoped role can write.

**Detect:** grep for `.insert(req.body)` / `.update(req.body)` and object spreads of
request data. The house pattern is a `Map`-based field allowlist applied through a
shared `pick(body, fields, columnMap)` helper.

**Empirical citation:** `packages/api/src/routes/calendars.ts` POST/PATCH and
`people.ts` POST "insert/update `req.body` passed directly with no field allowlist
(mass assignment); mitigated by RLS on request-scoped client" — the mitigation is
real but it is the only thing standing between the request and the column set. The
positive reference is `health-meds` (2026-09-11): "`ITEM_FIELDS`/`SCHEDULE_FIELDS`/
`FLAG_FIELDS` are `Map`-based allowlists applied via a shared `pick(body, fields,
columnMap)`", and `newsletter-unsubscribe`'s `logUnsubAttempt()`: "fixed field
allowlist literal object … never spreads `req.body`/decoded token fields wholesale."

**Failure message:** Request body reaches a DB write without a writable-field
allowlist.

**Fix:** build the write object field by field from an allowlist. Treat
request-scoped RLS as defense in depth, not as the control.

---

## `input-validation-and-injection/path-segment-not-encoded` — HARD

**Pattern:** an identifier is interpolated into a URL path template without
`encodeURIComponent()`. A value containing `../` collapses during URL normalization
and redirects the request — with the caller's credentials attached — to a different
endpoint on the same host.

**Detect:** grep every API client for path templates (`` `${BASE}/things/${id}` ``)
and check each interpolated segment for `encodeURIComponent`. Then trace the id back:
if it originates in a deep-link or route param, the surface is external.

**Empirical citation:** `packages/mobile` + `health-fitness/mobile/api.ts`
(2026-09-09, HARD): "`ModuleScreenHost` passes every extra query param from the
pushed route straight through as component props with no validation, and this route
is reachable through the app's own registered URL scheme … so
`gatewaze://m/health-fitness/program?id=<anything>` is an external, one-tap attack
surface." Confirmed empirically: "`new URL('https://api.example.com/api/health-fitness/programs/../../coach/threads')`
collapses to `https://api.example.com/api/coach/threads` (percent-encoded `%2e%2e`
collapses identically) — so a crafted `id` … makes the victim's device send a
request, WITH the victim's own valid bearer token attached and using whatever HTTP
method the calling action uses (e.g. `deleteProgram` issues DELETE), to an
attacker-chosen path." The sibling comparison is the important part:
`health-diet/mobile/api.ts` "is clean (every id encoded)" while `health-calendar`,
`health-core` and `health-body-metrics` were not — and within `health-body-metrics`,
`provider` was encoded while `id` was not.

**Failure message:** Path segment interpolated without `encodeURIComponent` — a
`../` value redirects the authenticated request.

**Fix:** `encodeURIComponent()` every interpolated path segment. Reject route params
containing `/` or `..` before they reach a screen. Consider asserting at the fetch
layer that the final pathname still starts with the expected prefix.

---

## `input-validation-and-injection/json-dumps-into-script-tag` — SHOULD

**Pattern:** a value is embedded in an inline `<script>` block via `json.dumps` /
`JSON.stringify` on the assumption that it is XSS-safe. Neither escapes `<`, `/`, or
U+2028/2029, so a value containing `</script` closes the tag.

**Detect:** grep for `json.dumps` / `JSON.stringify` output interpolated inside a
`<script>` block. Then check what constrains the values — a strict charset gate
upstream makes it unreachable, and the absence of one makes it live.

**Empirical citation:** `staging-provisioner.py` (2026-08-23): `progress_page()` and
`ready_page()` "both embed `json.dumps(…)` output directly inside an inline
`<script>` block … without neutralizing a `</script` substring — Python's
`json.dumps` does not escape `/`". Assessed as not exploitable at the time because
every reaching value was closed-set, but flagged because "the code's own header
comment overclaims full coverage … and a future change that reflects any
less-constrained field into `cfg` would silently become exploitable." The house
guidance from the sibling-proxy entry: "every value that gets hand-interpolated into
JS MUST be validated against a strict charset … BEFORE reaching `json.dumps()`, not
rely on `json.dumps()` itself for XSS-safety."

**Failure message:** Value embedded in a `<script>` block relies on JSON
serialization for XSS safety, which does not escape `<` or `/`.

**Fix:** charset-gate the value before interpolation, or route it through a
`json_for_script()` helper that escapes `<`, `>` and `&` to `\uXXXX`.

---

## `input-validation-and-injection/unsanitized-html-render` — SHOULD

**Pattern:** operator- or DB-sourced HTML is rendered without sanitization. The
trust argument is usually "only an admin can set this", which holds until the admin
surface itself is reachable or the content source widens.

**Detect:** grep for `dangerouslySetInnerHTML` and raw HTML injection into a
preview/iframe. Check whether a sanitizer runs and whether the iframe carries a
restrictive `sandbox`.

**Empirical citation:** `packages/admin/.../EmailTemplatesTab.tsx:496` (2026-04-28):
"admin email preview renders `content_html` without DOMPurify"; `packages/portal/app/(main)/privacy,
do-not-sell, terms` (2026-04-28): "`customHtml` from `platform_settings` rendered
without sanitization" — and `platform_settings` has a `USING(true)` SELECT policy.
The clean counter-reference is `EmailHistorySection.tsx`, where the preview iframe
"keeps the pre-existing `sandbox=\"\"` (blocks scripts)", and the environments admin
UI, which renders every ingested field "purely as JSX text interpolation … no
`dangerouslySetInnerHTML` anywhere", correctly escaping at the render boundary
rather than the storage boundary.

**Failure message:** DB-sourced HTML is rendered without sanitization or a
restrictive sandbox.

**Fix:** sanitize at the render boundary, or render as text. Where a preview must
show real markup, keep it in an iframe with `sandbox=""`.

---

## `input-validation-and-injection/independent-revalidation-convention` — SHOULD

**Pattern:** this codebase deliberately re-validates the same value at every trust
boundary it crosses rather than relying on an upstream check. A consumer that skips
its own validation breaks the convention even when the upstream check currently
holds — and the gap becomes live the moment a second writer appears or a file is
hand-edited.

**Detect:** for any value that crosses from a request into a file, a subprocess, or
a path, count the independent validations. The house standard is the full grammar
regex at each boundary. A looser check at one hop — a bash `case` glob instead of
the regex — is the finding.

**Empirical citation:** the convention is recorded for the Tier 1 live-mode scripts:
"EACH host shell script independently re-validates with its OWN Python
`isinstance(live, bool)` check and its OWN hardcoded repo allowlist … rather than
trusting the module's allowlist — real defense in depth, not redundant theater,
since the host scripts are the actual privileged execution surface." Violated in
`staging-lfx-boot-reconcile.sh` (2026-08-23, SHOULD): `root_env_label()` returned any
non-empty string, and "the caller then gates only with a bash `case \"$label\" in
lfx--*)` — a glob PREFIX match, not the `^lfx--[a-z0-9]([a-z0-9-]{0,47}[a-z0-9])?$`
grammar used everywhere else in this codebase — and bash `case` patterns are not
filename globs, so `*` happily matches `/` and `..`." Not exploitable at the time,
because the only writer already enforced the grammar; resolved in `c2457ff`.

**Failure message:** This consumer validates a crossed-boundary value more loosely
than every sibling consumer of the same value.

**Fix:** apply the same full grammar regex the rest of the codebase uses, evaluated
before any path or command is derived from the value.
