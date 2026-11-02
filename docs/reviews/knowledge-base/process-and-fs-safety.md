# Process and filesystem safety

Shell execution, dynamic imports, and paths derived from non-literals. The
platform imports module code at runtime and runs git against operator-supplied
sources, so both surfaces are load-bearing.

**Read when:** any `child_process` / `execFile` / `execSync`, any path built from a
non-literal, any dynamic `import()`, any archive extraction.

---

## `process-and-fs-safety/db-value-interpolated-into-shell` — HARD

**Pattern:** a value read back from the database is interpolated into a shell
command string. It was validated on the way in, or it was not, but by the time it
comes out of Postgres it reads as trusted.

**Detect:** grep for `execSync` / `exec` with a template literal. Trace every
interpolated value to its origin — a DB column is not an origin, keep going to the
write path. Everything outside `packages/api/src/lib/safe-exec.ts` is suspect; that
wrapper uses `execFileSync` with an allowlist (`git`, `pgbackrest`, `pg_dump`,
`pg_restore`) and no shell.

**Empirical citation:** `packages/api/src/routes/modules.ts` (sources/refresh),
flagged 2026-04-28: "branch value from DB is interpolated unsanitized into git
`execSync` shell commands"; a `validateBranch()` regex guard was added later and the
entry closes "verify still present". The audit gate exists precisely for this class:
`scripts/audit-shell-calls.ts` rejects a raw shell call outside the wrapper.

**Failure message:** DB-sourced value is interpolated into a shell command string.

**Fix:** route through `safe-exec.ts` with an argv array. Validate the value at the
write path *and* re-validate before use.

---

## `process-and-fs-safety/argv-array-does-not-redact-secrets` — HARD

**Pattern:** a command is run with `execFile` and an argv array, which is correctly
cited as preventing command injection — and is then assumed to also keep a secret
inside one of those arguments out of logs. It does not.

**Detect:** for any `execFile`/`spawn` whose argv can contain a credential (a
tokenized clone URL, a `--password` value), find the redaction at the call site
before the error reaches a logger. Absence is the finding.

**Empirical citation:** confirmed by direct test 2026-08-03: "a rejected
`execFile('git', [...argv])` (no shell) still produces an `error.message` of the
form `Command failed: git <argv joined with spaces>\n<stderr>` — i.e. Node's own
error formatting re-serializes the full argv INCLUDING any secret baked into an
argv element (e.g. an `https://x-access-token:<PAT>@github.com/...` remote URL),
even though execFile itself never touched a shell. So 'we used execFile with an
argv array, not a shell string' prevents *command injection* but does NOT by itself
prevent a secret embedded in one of those argv elements from reaching a log."
`software-engineer/lib/git.ts`'s `redactSecrets`/`redactToken` does this correctly —
"splits the message on the literal token substring, longest-first, before any regex
fallback" — and was verified against a real failure message.

**Failure message:** Secret embedded in an argv element will appear verbatim in the
error message; argv-not-shell does not redact it.

**Fix:** redact at the call site before logging, on the literal token substring.
Treat "argv array, no shell" as necessary and not sufficient.

---

## `process-and-fs-safety/toctou-extract-before-verify` — HARD

**Pattern:** an archive is extracted and *then* checked for path traversal. By the
time the check runs, the files are already on disk.

**Detect:** in any upload/extract path, establish the order of extraction and
validation. The check must gate the write, not follow it.

**Empirical citation:** `packages/api/src/routes/modules.ts` (upload): "TOCTOU in zip
path-traversal check: extract before verify (confirmed still present 2026-04-28)",
recorded in the patterns file as "known pattern in this codebase".

**Failure message:** Archive is extracted before the path-traversal check runs.

**Fix:** validate every entry path before writing it, or extract to a scratch
directory and move verified entries across.

---

## `process-and-fs-safety/module-id-reaches-path-or-import-unchecked` — HARD

**Pattern:** a module id is used to build a filesystem path or a dynamic `import()`
specifier without passing the shape gate. DB-sourced ids look safe and are safe only
because every write path currently funnels through the gate.

**Detect:** the gate is `SAFE_MODULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,127}$/` in
`packages/shared/src/modules/loader.ts` `validateModule()`, re-checked at the top of
`applySnapshotUpdate()`. Any new function taking a moduleId and reaching
`resolveSourceForModule()`, `liveModuleDir()`, `installLiveSnapshot()` or an
`import()` must sit downstream of one of those two checks.

**Empirical citation:** the convention is stated directly: "don't assume DB-sourced
ids (`module_updates_available.module_id`, `installed_modules.id`) are inherently
safe; they're safe here only because every write path funnels through
`validateModule()`/`SAFE_MODULE_ID_RE` first." The residual gap, confirmed
2026-08-27: "`validateModule()` still does not validate the shape of the
module-declared `id` field (only checks non-empty string)… the new
`refreshModuleConfigFromLiveTree` converts a previously restart-gated risk (Node ESM
cache meant a bad path only got imported after a manual API restart) into an
immediate one." Low likelihood, RCE impact. The same gap widened again on
2026-09-04 when `MODULE_SOURCES` parsing was extended into `job-worker.js` and
`start-scheduler.js`: "neither file's module-directory-discovery loop runs a
`SAFE_MODULE_ID_RE`-equivalent shape check on discovered directory names before
dynamic `import()`."

**Failure message:** Module id reaches a path or dynamic import without the
`SAFE_MODULE_ID_RE` gate.

**Fix:** validate against `SAFE_MODULE_ID_RE` before any path or import specifier is
built from it, including for directory names discovered by a scan.

---

## `process-and-fs-safety/shared-predictable-path-instead-of-mkdtemp` — HARD

**Pattern:** a cache or workspace is created at a fixed, predictable path shared
across tenants, while every other workspace in the codebase uses `mkdtemp()` into a
fresh random directory. The code's own comment usually claims per-tenant isolation,
which holds for the selection logic and not for filesystem reachability.

**Detect:** for every clone/extract/workspace directory, check whether the path is
random-per-run or derived from a stable key. Then ask who else can read that
filesystem — in this codebase, agent sessions run as root on a shared host.

**Empirical citation:** `software-engineer/lib/skills.ts` (2026-08-03, HARD, resolved
same-day): "`resolveProjectSkills()` clones each admin-configured skills repo into
`os.tmpdir()/se-skills/<projectId>/<repo>--<ref>` and caches it across runs (unlike
every other clone in this codebase — `worktree.ts` `makeWorkspace`/`makeMultiWorkspace`
always use `mkdtemp()` into a fresh random per-run dir, never reused)." Because the
worker pool serves multiple projects on one host and the agent's Bash tool runs as
root, "any project's live session can `ls`/`cat /tmp/se-skills/<other-project-uuid>/…`
and read another tenant's private skills-repo content — defeating the module's own
in-code claim". Worse, the refresh path used `reset --hard` without `git clean`, so
"a hostile session in Project A could plant an extra file/hook inside Project B's
cached clone that SURVIVES future refreshes and later loads as a trusted local
plugin into Project B's own session — cross-tenant, time-delayed code execution."

**Failure message:** Workspace uses a stable shared path where every sibling
workspace in this codebase uses `mkdtemp()`.

**Fix:** use `mkdtemp()` per run and return a `cleanup()` the caller invokes in a
`finally`. If a cache is genuinely required, add `git clean -xdf` after any
`reset --hard`, and check symlink containment with
`realpath(child).startsWith(realpath(dir) + sep)` — including the separator, to
avoid the `/tmp/foobar` vs `/tmp/foo` prefix collision.

---

## `process-and-fs-safety/plain-http-git-remote-accepted` — SHOULD

**Pattern:** the scheme allowlist for a git remote gains `http://`. The cloned code
is later imported and its migrations executed, so an on-path attacker can swap what
runs.

**Detect:** read the `isGit` prefix check on any module-source path. `https://`,
`git://`, `git@` and a `.git` suffix are the intended set.

**Empirical citation:** `packages/api/src/routes/modules.ts` (2026-08-27, SHOULD,
unresolved): "the pre-existing `sources/refresh` `isGit` prefix check gained
`http://` alongside `https://`/`git://`/`git@`/`.git` — plain-HTTP git remotes are
now accepted as valid module sources, meaning an on-path attacker can MITM-swap the
cloned code that later gets imported (`refreshModuleConfigFromLiveTree`) AND has its
migrations executed against Postgres (`applyModuleMigrations`)."

**Failure message:** Plain-HTTP git remotes are accepted as module sources.

**Fix:** require `https://` / `git@` / `git://`, or gate `http://` behind an explicit
opt-in flag.

---

## `process-and-fs-safety/internal-error-detail-reaches-client` — SHOULD

**Pattern:** an error that was previously swallowed starts being surfaced to the
client, and its message carries filesystem paths or raw database error text.

**Detect:** when an error path changes from silent to surfaced, read what the
message can contain — `readFileSync` errors embed full paths, `JSON.stringify(error)`
on a Postgres error embeds server internals.

**Empirical citation:** `packages/api/src/routes/modules.ts` `applySnapshotUpdate()`
(2026-08-27, SHOULD): the error message "can embed a full filesystem path (`fullPath`
from `readFileSync` error) or a raw `JSON.stringify(error)` Postgres error. Reaches
the admin UI verbatim (rendered as toast text via `sonner`, so no XSS, but real info
disclosure of server paths/DB errors). Was previously silently ignored (pre-diff), so
this is new exposure, not a pre-existing one."

**Failure message:** Newly surfaced error message carries filesystem paths or raw DB
error text to the client.

**Fix:** map to a stable message and log the detail server-side. Note explicitly
whether the exposure is new in this diff — a pre-existing leak and a newly
introduced one warrant different urgency.
