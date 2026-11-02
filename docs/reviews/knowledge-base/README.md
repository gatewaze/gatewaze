# Security review knowledge base

Empirical review patterns for the Gatewaze platform and the repos it reviews
alongside it (`gatewaze-modules`, `gatewaze-environments`, `packages/mobile`).

Every entry here was extracted from a real finding on this codebase. Unlike
`.claude/rules/*.md`, which states how code *should* be written, this knowledge
base records what has actually gone wrong, how it was spotted, and what the fix
was — so the next review starts from the accumulated result instead of
re-deriving it.

## Why this exists as committed files

This content originated in `.claude/agent-memory/pragma-security/`, the learned
memory the `pragma:security` agent maintains as it reviews. That directory is
git-ignored (`.gitignore`, `**/.claude/agent-memory/`), which the root
`CLAUDE.md` states plainly: it "improves over a working session but does not
travel between clones."

That is the right design for a scratchpad and the wrong one for institutional
knowledge. A finding like "`allow-same-origin` on a shared arcade origin lets one
game read another's storage" cost real review effort to establish; on a fresh
clone, in CI, or for any other contributor, it does not exist. These files are
the durable half: the patterns general enough to fire again, promoted into the
repo so they survive a clone, a new machine, and a change of maintainer.

The agent memory stays where it is and keeps doing its job. When it produces a
pattern that will recur, promote it here.

## Routing

Read the files whose condition matches what changed. Do not blanket-read.

| File | Read when |
| ---- | --------- |
| `module-route-authz.md` | any `api/register-routes.ts`, `api/admin-routes.ts`, `packages/api/src/routes/**`, or any new route/router mount |
| `rls-and-postgrest.md` | any `migrations/*.sql`, `supabase/migrations/**`, or any `.or()` / PostgREST query builder use |
| `input-validation-and-injection.md` | any handler reading `req.body`/`req.params`/query params, any string interpolated into JSON, markdown, a URL path, or HTML |
| `process-and-fs-safety.md` | any `child_process`/`execFile`/`execSync`, any path built from a non-literal, any dynamic `import()`, any archive extraction |
| `network-and-resource-limits.md` | any `fetch()`, any HTTP server or proxy, any worker/thread pool, any externally-triggerable subprocess |
| `shared-infra-trust-boundary.md` | any `gatewaze-environments` manifest, Helm chart, k8s YAML, or anything deployed into a namespace shared with per-env pods |
| `known-false-positives.md` | always — applied last, drops findings that are not real on this codebase |

## Entry format

````text
## `<category>/<pattern-id>` — HARD | SHOULD | WARN

**Pattern:** what it looks like.

**Detect:** the operational check. Grep, read, or test — not a vibe.

**Empirical citation:** where it was found, and the quote that established it.

**Failure message:** what to emit when it matches.

**Fix:** the concrete remedy.
````

Severities match the vocabulary the security reviews already use: **HARD** is a
real, reachable defect; **SHOULD** is defense-in-depth or a latent gap behind a
currently-holding invariant; **WARN** is worth knowing and not worth blocking on.

## Using these

An entry is a starting point, not a verdict. Every one of them carries a date and
a code location, and this codebase moves — re-verify against current code before
acting on a match. Several entries below were already resolved after they were
written; they are kept because the *pattern* recurs even when the instance is
fixed.

The one rule that matters: **if you cannot point at the line, it is not a
finding.** These entries tell you where to look, not what to conclude.
