# Network fetches and resource limits

Outbound requests that trust a redirect, and inbound surfaces with no ceiling. The
resource-limit half is the one that gets skipped most often, because nothing fails
until someone tries.

**Read when:** any `fetch()`, any HTTP server or proxy, any worker/thread pool, any
externally-triggerable subprocess.

---

## `network-and-resource-limits/allowlist-not-rechecked-across-redirect` — HARD

**Pattern:** a host allowlist validates the *initial* URL, then the fetch follows
redirects. `fetch` does not re-check the destination on a 3xx, so an allowlisted
host can bounce the request to anything — including RFC1918 and link-local.

**Detect:** for every `fetch` with `redirect: 'follow'` behind a host allowlist,
confirm the allowlist runs on each hop. Also read the allowlist entries themselves:
a bare suffix wildcard admits anything under that suffix.

**Empirical citation:** `software-engineer/lib/attachments.ts` (2026-07-31, HARD):
"`hostAllowed()` validates only the *initial* request URL; `fetch(raw, { headers,
redirect: 'follow' })` never re-validates the final/redirected URL against the
allowlist, and undici will follow a 3xx to any scheme/host including
RFC1918/link-local." The allowlist itself compounded it: "`h.endsWith('.supabase.co')`
is a bare suffix wildcard that admits ANY attacker-registerable Supabase project
(free tier, e.g. via a self-authored Edge Function that emits a 302)". Reachability
was wider than the admin form, because `phase-runner.ts` re-fetches the live issue
body at agent-run time — "so anyone who can edit the GitHub issue body directly can
trigger this."

**Failure message:** Host allowlist is checked once and the fetch follows redirects
without re-checking.

**Fix:** use `redirect: 'manual'`, loop, and re-run the allowlist on every `Location`
up to a small max-hops count. Narrow suffix wildcards to exact origins. See
`known-false-positives.md` for what redirect-following does *not* expose.

---

## `network-and-resource-limits/response-buffered-before-size-check` — SHOULD

**Pattern:** a size cap is enforced after the whole body is already in memory. The
cap describes what is stored, not what is read, so an allowlisted-but-hostile origin
can still exhaust memory.

**Detect:** find the order of `arrayBuffer()`/`text()` and the `MAX_BYTES`
comparison. A cap that reads a `.length` on an already-materialized buffer is the
finding. Check for a `signal`/timeout on the same call while you are there.

**Empirical citation:** same `attachments.ts` entry (2026-07-31, lower severity,
same functions): "response body is fully buffered via `Buffer.from(await
r.arrayBuffer())` before the `MAX_BYTES` check — no streaming/Content-Length cap, so
an allowlisted-but-attacker-controlled origin can still cause memory-exhaustion DoS
before the size check ever fires. No `signal`/timeout on the fetch either."

**Failure message:** Size cap is applied after the body is fully buffered, and the
fetch has no timeout.

**Fix:** enforce the cap while streaming, or check `Content-Length` first and abort.
Attach an `AbortSignal` with a timeout on every outbound fetch.

---

## `network-and-resource-limits/threading-server-without-bounded-semaphore` — SHOULD

**Pattern:** a `ThreadingHTTPServer` subclass ships with no cap on concurrent
threads, so any client can exhaust the pool. The house style requires a
`BoundedSemaphore`-gated `process_request` / `process_request_thread` override.

**Detect:** for every `ThreadingHTTPServer` subclass, look for the semaphore
override. Its absence is the finding — including, especially, when a sibling file in
the same directory already has one.

**Empirical citation:** `staging-html-injector.py` (2026-08-23): "unlike the sibling
`staging-provisioner.py` (already fixed same-day with `BoundedThreadingHTTPServer` +
`BoundedSemaphore(32)`), this NEWER proxy's `Server(ThreadingHTTPServer)` had NO
thread cap at all — and sits on a HOTTER path than the provisioner (every HTML
document navigation for the app, not just first-visit provisioning)." The house
style entry draws the general lesson: "don't assume a sibling file inherited a fix
just because it's adjacent/recent."

**Failure message:** Threading server has no concurrency cap while a sibling server
in the same family does.

**Fix:** port the `BoundedSemaphore` `process_request`/`process_request_thread`
override, sized for the path's traffic.

---

## `network-and-resource-limits/expensive-work-before-rate-limit` — HARD

**Pattern:** a handler does the expensive thing — spawns a subprocess, hits a
metered API — before the rate limiter runs. The limiter protects the cheap half.

**Detect:** in every rate-limited handler, establish the line number of the limiter
call and list every side effect above it. Subprocess spawns and outbound calls above
that line are unprotected.

**Empirical citation:** `staging-provisioner.py` (2026-08-23, HARD): "`handle_env_host()`'s
absent-state branch calls `grammar_parse(label)` (itself
`subprocess.run([PY, ENVLABEL, ...], timeout=15)`) for EVERY request to a never-seen
`lfx--`-prefixed hostname, and `trigger()` calls `grammar_encode(spec)`
UNCONDITIONALLY before `rate_limit_trigger(ip)` is checked — so both subprocess
spawns happen before any per-IP throttling." Because a wildcard route sent every
`lfx--*` hostname to this service, "an attacker can force unlimited `python3
lfx-envlabel.py` process forks with zero rate-limit protection." The entry notes the
contrast: "GitHub API calls (the actually-metered, cached part) ARE correctly gated
behind `rate_limit_trigger` — only the grammar-helper subprocess calls are not."

**Failure message:** Subprocess spawn or outbound call happens before the rate
limiter.

**Fix:** move the limiter above every side effect, cache the derived value per key,
and bound concurrency with a semaphore for anything that forks.

---

## `network-and-resource-limits/shared-quota-exhausted-by-one-caller` — SHOULD

**Pattern:** a per-caller limit exists, but the resource behind it is shared and much
smaller than the limit implies. Distributing requests across a handful of callers
exhausts the shared budget and turns a fail-closed safety property into an
availability attack.

**Detect:** for every rate limiter, identify the underlying shared budget — an
unauthenticated third-party API quota, a fixed pending-slot count — and compare it
against `per-caller limit × plausible caller count`.

**Empirical citation:** `staging-provisioner.py` (2026-08-23): no `GITHUB_TOKEN` was
set in the LaunchAgent plist, "so `gh_get()` runs against GitHub's unauthenticated
60-req/hr budget from the box's single egress IP — an attacker distributing trigger
attempts across a handful of distinct source IPs (each under the 10/hr per-IP
`RATE_MAX`) can exhaust that shared 60/hr budget and force `verdict == 'unavailable'`
for every OTHER visitor too, hitting the documented fail-closed path … as an
availability attack instead of its intended safety property." Same file: "`MAX_PENDING
= 3` is trivially exhausted by one visitor cycling through 3 distinct valid PR
labels."

**Failure message:** Per-caller limit does not protect the smaller shared budget
behind it.

**Fix:** authenticate the upstream call to raise the shared budget, and size
per-caller limits against the shared resource rather than against a single caller's
expected use.

---

## `network-and-resource-limits/hand-rolled-http-framing` — HARD

**Pattern:** a proxy parses or serializes raw HTTP itself. Request smuggling and
header injection follow from lenient framing, and Python's stdlib makes two specific
mistakes easy.

**Detect:** for any hand-rolled body reader, check: is an oversized *chunked* body
handled as well as an oversized Content-Length body; are Content-Length and
`Transfer-Encoding: chunked` both-present rejected rather than resolved; are multiple
conflicting Content-Length values rejected. For any hand-serialized header write,
check for CR/LF stripping.

**Empirical citation:** `staging-html-injector.py` (2026-08-23, three HARD findings,
fixed in place). Framing: the 413 guard "only covered the Content-Length-declared-too-large
case — an oversized CHUNKED body also returned `body=None` but the guard never
tripped … leaving whatever un-drained chunk bytes remained on the socket to be
misparsed as the start of the NEXT request on that persistent connection — classic
desync." Header injection: "confirmed empirically that Python's own HTTP header
parser preserves obsolete RFC-9112 line-folding verbatim — `\"X-Test: line1\\r\\n
continuation\"` parses to a header VALUE containing the raw embedded `\\r\\n `", and
both serializers wrote it back out with a plain f-string. The house rule: anything
written outside `HTTPConnection.putheader()` "is a response/request-splitting vector
by default, not just in theory."

**Failure message:** Hand-rolled HTTP framing accepts ambiguous requests or writes
unsanitized header values.

**Fix:** reject CL+TE, multiple Content-Lengths, non-digit lengths, and malformed
chunk lines — close the connection rather than guessing. Collapse any
`[\r\n]+[ \t]*` run to a single space in every hand-serialized header value.

---

## `network-and-resource-limits/security-header-read-with-get-not-get-all` — SHOULD

**Pattern:** a security decision reads a header with `.get()`, which silently returns
the *first* occurrence. If a client's own value ever survives alongside the proxy's,
the client wins.

**Detect:** for every header a trust decision depends on — `Host`, `X-Forwarded-Host`,
`X-Forwarded-For` — check for `get_all(name)` and a length assertion.

**Empirical citation:** `staging-html-injector.py` (2026-08-23, SHOULD): "`_upstream_port()`/`_public_label()`
used `.get(\"Host\"/\"X-Forwarded-Host\")` (first-occurrence-wins) with no check that
exactly one header line was present; if a future middleware change ever `Add()`ed
instead of `Set()`-replaced … the CLIENT's own value would win over traefik's
canonical one." Fixed by requiring `len(get_all(...)) == 1` and failing closed. The
house rule: "never trust `self.headers.get(name)` for a header a security decision
hinges on without also checking `get_all(name)` has exactly one value."

**Failure message:** Security-relevant header read with `.get()` — a duplicate header
silently wins.

**Fix:** require exactly one occurrence via `get_all()` and fail closed otherwise.

---

## `network-and-resource-limits/denylist-checked-before-resolution` — SHOULD

**Pattern:** a never-do-this denylist is applied to a value *before* a later
substitution step replaces it with one resolved from a different, less-trusted
source. The guarantee the denylist exists to provide silently does not hold for the
resolved value.

**Detect:** for any denylist check followed by a resolution/substitution step, confirm
the check is re-applied after resolution.

**Empirical citation:** `staging-html-injector.py` (2026-08-23, SHOULD): "`_public_label()`'s
hardcoded `DENY_LABELS`/`-auth`-suffix never-instrument check ran BEFORE the
`label == ROOT_LABEL` → `root_env_label()` substitution, so a resolved root-env label
(sourced from a DIFFERENT trust boundary) was never re-checked against the denylist —
if that file ever named an env like `lfx-auth`, the Authelia-login-adjacent
never-instrument guarantee the file's own docstring promises would silently not
hold." Fixed by re-running the check after resolution.

**Failure message:** Denylist is applied before a substitution that can introduce a
denylisted value.

**Fix:** re-apply the check after every resolution step that pulls from a different
source.
