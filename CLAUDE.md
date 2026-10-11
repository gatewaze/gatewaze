# Gatewaze — working agreement for AI coding agents

This file is loaded automatically at the start of every session in this repo.
It applies to everyone. It tells you how we expect code to be written, reviewed,
and shipped here. Follow it unless the human tells you otherwise in the session.

## Source of truth (in order)

1. The human's instructions in the current session.
2. `CLAUDE.local.md` — machine-specific, per-developer overrides (not committed).
3. This file — the shared, committed contract.
4. `.claude/rules/*.md` — path-scoped rules applied during review. `pragma`
   review globs these, filters by each file's `paths:` frontmatter against what
   changed, and applies the most specific match. The universal file
   (`lint-and-ci.md`, no `paths:`) always applies.
5. `docs/reviews/knowledge-base/*.md` — empirical review patterns. Where
   `.claude/rules/` says how code should be written, these record what has
   actually gone wrong here, how it was spotted, and what the fix was. Routed by
   changed path (see that directory's `README.md`); `known-false-positives.md`
   is applied last and overrides any other match.
6. The skills in the `gatewaze-skills` and `pragma` plugins (both distributed
   through the committed `gatewaze-skills` marketplace; `pragma` is pinned to an
   exact commit SHA there for supply-chain safety).

If two rules conflict, prefer the more specific one and say so.

## Security is part of every task

Every change that touches code gets a security pass before it is committed.
This is not optional and not only for "security work" — a copy-change to a route
handler can open a hole as easily as an auth refactor.

Concretely, before you commit code you have written or modified:

1. Run a security review of the diff. Use `/security-review`, or the
   `pragma:security` skill, or `/pragma:review` (which runs the security
   validator plus the language and error-handling validators). For a
   multi-commit branch, review the whole branch diff, not just the last commit.
2. Apply the relevant `.claude/rules/*.md` for the paths you touched. The high-
   frequency ones live in `security-boundaries.md`: PostgREST `.or()` filter
   injection, mass assignment via `req.body`, enum/string-union validation,
   service-role null-guards, ICS CR/LF injection, path-param validation, rate-
   limiting public endpoints, SSRF, and shell-command safety.
3. Fix what you find, then re-run until clean. Report what you checked and what
   you changed.

The `pragma:security` agent keeps a learned memory under
`.claude/agent-memory/pragma-security/`. It is machine-local (git-ignored), so
it improves over a working session but does not travel between clones. Treat its
recurring-issue notes as hints, not gospel — verify against current code.

**When that memory produces a pattern that will recur, promote it into
`docs/reviews/knowledge-base/`.** That directory is the durable half: committed,
so it survives a fresh clone, a new machine, and a change of maintainer. The
memory stays a working scratchpad; the knowledge base is what the next reviewer
actually inherits.

## The commit-and-push cycle

- **After every commit**, run the review set (`/pragma:review` or, at minimum,
  `pragma:security`) if you have not already for that diff.
- **Before every push / PR**, the diff must pass the security review above and
  the local checks below, plus `/preflight` (mechanical checks, then the
  security-boundary checklist).
- **Also before every push / PR**, run `/evidence-review` and `/test-coverage`.
  These cover what the validators structurally cannot. Every `pragma` validator
  declares a narrow scope and a `MUST NOT report on` block — every one of them
  disowns performance, three of four disown test coverage, and there is no
  validator for either — while `/preflight` Phase 2 walks a fixed checklist.
  A real defect that is not on somebody's list has no other owner.
  - `/evidence-review` ships only findings it can prove at `file:line`. Its
    highest-yield check is sibling divergence, because this codebase's own
    review history is dominated by one module doing correctly what the module
    beside it does not.
  - `/test-coverage` applies the inversion test: for each new condition, invert
    it and ask which existing test fails. If none would, the branch is unpinned.
  Both are report-only. Fix what they find, or say why you are not.
- A **blocking pre-push hook** (`.husky/pre-push`) runs a deterministic gate
  before anything reaches the remote: a gitleaks secret scan over the commits
  being pushed, plus the shell-call audit. It requires `gitleaks` installed
  locally (`brew install gitleaks`). Do not routinely bypass it with
  `--no-verify`; if you must in a real emergency, say so explicitly and note
  that CI will still run both checks.
- CI (`.github/workflows/`) runs the full matrix: typecheck, lint, tests,
  `pnpm audit`, the shell-call audit, pgTAP RLS tests, CodeQL, gitleaks, and
  OpenSSF Scorecard. Green CI is required to merge.

## Never do these

- Never commit a real secret. Keys, tokens, and passwords go in env files that
  are git-ignored (`docker/.env.*`, `.env.local`), never in tracked source,
  tests, READMEs, or example files. Example files carry placeholders only.
- Never add a raw shell call (`child_process.exec`, `execSync` with a single
  string, `spawn` with `shell: true`) outside `packages/api/src/lib/safe-exec.ts`.
  The `scripts/audit-shell-calls.ts` gate will reject it.
- Never interpolate unsanitised user input into a PostgREST `.or()` filter, a
  SQL string, an ICS line, or a constructed URL. Sanitise and validate first —
  see `.claude/rules/security-boundaries.md` for the exact helpers.
- Never insert `req.body` directly. Use an allowlist of writable fields.
- Never widen a GitHub Actions `permissions:` block or unpin an action from its
  commit SHA without a stated reason. Least privilege and SHA pins are the
  default here.
- Never import `@radix-ui/themes` directly inside a module file — it duplicates
  the Radix singleton in production builds and crashes `useThemeContext`.
- Never disable a rule, validator, or CI gate to make a change pass. Fix the
  code, or raise the tradeoff with the human.

## Setup for a fresh clone

Trust the workspace in Claude Code and the `gatewaze-skills` and `pragma`
plugins auto-install from committed `.claude/settings.json`. Then:

- `brew install gitleaks` (required by the pre-push hook).
- `pnpm install` (installs husky hooks via the `prepare` script).
- `git config commit.gpgsign true` and sign off commits (DCO) — see
  `CONTRIBUTING.md`.

See `SECURITY.md` for how to report a vulnerability.
