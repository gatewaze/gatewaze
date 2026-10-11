# Shared infrastructure trust boundary

One recurring structural fact drives every entry here: the `lfx` namespace on the
staging box hosts per-env pods built from **untrusted, externally-authored GitHub PR
heads**, alongside shared services. Anything reachable in that namespace is
reachable by attacker-authored code.

The security memory logged this same root cause three separate times before it was
named. That is what this file is for.

**Read when:** any `gatewaze-environments` manifest, Helm chart, or k8s YAML, and
anything deployed into a namespace shared with per-env pods.

---

## `shared-infra-trust-boundary/shared-service-reachable-by-untrusted-env-pod` — HARD

**Pattern:** a shared service is added to the `lfx` namespace with no authentication,
on the reasoning that it is internal. Per-env pods in that same namespace are built
from `refs/pull/<n>/head` of externally-authored PRs, so "internal" includes code
written by anyone who can open a pull request.

**Detect:** for every new Deployment/Service in a namespace that also hosts per-env
pods, ask what authenticates a caller. A `NetworkPolicy` is not the answer on this
cluster — see the note below. Then ask what the service holds or is trusted for:
sessions, telemetry attribution, routing.

**Empirical citation:** logged three times, same root cause.

1. `lfx-staging/session-redis.yaml` (2026-08-23, HARD): the new `lfx-session-redis`
   Deployment — Authelia's session store — ran `redis:7-alpine` "with no
   `--requirepass`/ACL and there is no `NetworkPolicy` anywhere in this repo
   restricting who can reach `lfx-session-redis:6379`." Because the same diff
   deployed per-env newsletter pods into the same namespace, "any such PR-authored
   container … has unauthenticated network access to the cluster's shared Authelia
   session store and can read/hijack/tamper with ANY session (including the primary
   env's / an admin's)." Resolved in `042fcac` with `--requirepass` from a
   SOPS-encrypted secret.
2. `lfx-staging/otel-collector.yaml` (2026-08-23, HARD): "same trust-boundary shape as
   the `lfx-session-redis` finding above". The OTLP/gRPC receiver had no auth and no
   TLS, and "nothing at the collector enforces that a pod can only claim its own
   label" — letting one env's workload forge `service_error` events attributed to any
   other env. Data-integrity impact rather than session theft, "but same root cause
   and same fix family."
3. `gatewaze-environments` commit `744d720` (2026-08-23, SHOULD): root-domain
   assignment, "a new instance of the shared-namespace-untrusted-PR-pod pattern
   already logged twice above, this time reaching a production-facing surface." While
   an env holds the root assignment, "real subscriber traffic to the shared
   `lfx-api.pr-view.com` newsletter routes (unsubscribe clicks, tracking pixels, from
   newsletters already sent to real recipients) is served by untested PR-branch code"
   — "a materially larger blast radius than the feature's own UI/API framing suggests."

**Failure message:** New shared-namespace service has no authentication, and that
namespace hosts pods built from untrusted PR heads.

**Fix:** authenticate at the service — `--requirepass` from a SOPS-encrypted secret,
an OTLP `bearertokenauth`/`basicauth` receiver extension, a shared token distributed
only to legitimate pods. Add a `NetworkPolicy` as declared intent, but do not count
it as the control.

**Known environment fact — do not treat a NetworkPolicy as enforcement here.** The
OrbStack k8s cluster runs no NetworkPolicy controller. This was verified: "a probe
pod connected even with the policy applied", and the accompanying manifest comment
says the policy is declared intent only. Re-check if this workload ever moves to a
cluster that enforces them.

---

## `shared-infra-trust-boundary/blast-radius-wider-than-the-feature-framing` — SHOULD

**Pattern:** a feature's UI copy, API name, and confirm dialog describe a narrow
effect, while the implementation routes a shared production-facing surface. Nobody
lied; the framing just never caught up with what the route clone actually does.

**Detect:** for any feature that repoints routing, enumerate every host and path the
changed rule matches, not just the one named in the UI. Compare that set against what
the confirm dialog tells the operator.

**Empirical citation:** commit `744d720` (2026-08-23): `render_root()` "clones the LIVE
`lfx-api-public-prview` IngressRoute (whose Host rule is the SHARED
`lfx-api.pr-view.com` … referenced as the base URL newsletter emails embed in
unsubscribe links and tracking pixels) and re-points only the newsletter-service
routes at the target env's own suffixed Service, at `priority: 200` so it wins the
tie against the canonical rule." The finding is explicitly a disclosure gap:
"neither the admin API route nor the confirm-dialog copy in `EnvironmentsPanel.tsx`
mentions it." Sweep-on-demotion was correctly wired, so this was scope, not cleanup.

**Failure message:** Routing change affects a shared production surface the feature's
own copy does not mention.

**Fix:** narrow the cloned rule to the intended host, or state the real blast radius
in the confirm dialog and the route's documentation.

---

## `shared-infra-trust-boundary/state-persisted-after-the-effect-it-guards` — SHOULD

**Pattern:** a control applies its effect first and records the state second. A crash
between the two leaves the system doing one thing and reporting another — and any
guard that reads the recorded state makes the wrong call.

**Detect:** for any pair of (apply effect, persist state), check the order and the
rollback on every failure branch below it. Then find every consumer of the persisted
state and ask what it does with a stale value.

**Empirical citation:** `assign_root()` (2026-08-23, SHOULD): it "applies the k8s
IngressRoute and only calls `root_set()` afterward; a host-agent crash/restart
between those two steps leaves the cluster actually routing to the target env while
`root_get()` still reports the old value, which would let the TTL reaper's exemption
miss the actual current root holder and reap it out from under live traffic."
Resolved in `9519cb8`: `root_set` now runs first and "every failure branch below it
explicitly rolls back via `root_set \"$current\"`". The same commit added the direct
guarantee rather than relying on the ordering alone — `teardown_env`/`reap_env` refuse
when the label is the root holder, with a matching 409 in the module route and a test
asserting no request file is written.

**Failure message:** State is persisted after the effect it guards; a crash between
them makes the guard read a stale value.

**Fix:** persist first, roll back on every failure branch, and add a direct refusal at
the consumer rather than depending on ordering alone.

---

## `shared-infra-trust-boundary/root-in-container-with-writable-hostpath` — SHOULD

**Pattern:** a container runs as root and mounts a writable `hostPath`. Standard
privilege-escalation combination, and worth scoping rather than assuming the worst.

**Detect:** grep manifests for `runAsUser: 0` alongside a `hostPath` volume. Then
scope it: which directory, and what reads what is written there.

**Empirical citation:** `otel-collector.yaml` (2026-08-23): "the collector container
runs `securityContext.runAsUser: 0` (root) while also holding a writable `hostPath`
into the box's shared mac filesystem … root-in-container + hostPath is a standard
privilege-escalation combination (CIS Kubernetes Benchmark)". The scoping is the
useful half: "scope is limited to the `otel` subdirectory only (not the parent
`staging-control` where `envs/*.json`/`events.jsonl` live), so a compromised
collector can't directly forge lifecycle/status files, only otel error-file content —
which the tailer already treats as fully hostile (bounded json.loads/truncation/json.dumps
re-encoding), so no downstream injection follows from this path today."

**Failure message:** Container runs as root with a writable hostPath mount.

**Fix:** drop `runAsUser: 0` — use a non-root UID with matching directory ownership,
or an initContainer chown. Where root is genuinely required, say why, and keep the
hostPath scoped to the narrowest subdirectory.
