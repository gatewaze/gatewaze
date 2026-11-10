# Gatewaze — working agreement for AI coding agents

This file is loaded automatically at the start of every session in this repo.
It applies to everyone. It tells you how we expect code to be written, reviewed,
and shipped here. Follow it unless the human tells you otherwise in the session.
`AGENTS.md` is a symlink to this file so other agents read the same contract.

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

Every commit gets a security pass, and every branch gets one full review round
before it is pushed. This is not optional and not only for "security work". A
copy change to a route handler can open a hole as easily as an auth refactor.

The `gatewaze-skills` plugin ships two Claude Code hooks that drive this. They
are active in any repo whose root `CLAUDE.md` names
`/gatewaze-skills:review-round`, which this one does.

- After every `git commit` the agent runs, the after-commit hook asks the
  session to launch `pragma:security` as a background subagent on exactly that
  commit. It is report-only and pinned to the commit SHA, and it reads files
  with `git show`, never the working tree. It applies
  `.claude/rules/security-boundaries.md` and the routed knowledge-base entries.
  Verify its findings yourself and fix the confirmed ones in a follow-up commit
  whose subject starts with `fix(security):`. A commit with a `(review)`,
  `(preflight)` or `(security)` scope does not trigger the pass again.
- Before any `git push` or `gh pr create` on a feature branch, the before-push
  hook refuses unless the branch carries the review stamp that
  `/gatewaze-skills:review-round` writes. It also refuses if the branch was
  rewritten after the review, or if a commit after the stamp is not a
  `(review)` or `(preflight)` fix commit.

The high-frequency rules live in `security-boundaries.md`: PostgREST `.or()`
filter injection, mass assignment via `req.body`, enum/string-union validation,
service-role null-guards, ICS CR/LF injection, path-param validation,
rate-limiting public endpoints, SSRF, and shell-command safety.

The `pragma:security` agent keeps a learned memory under
`.claude/agent-memory/pragma-security/`. It is machine-local (git-ignored), so
it improves over a working session but does not travel between clones. Treat its
recurring-issue notes as hints, not gospel, and verify against current code.
When that memory produces a pattern that will recur, promote it into
`docs/reviews/knowledge-base/`. That directory is the durable half: committed,
so it survives a fresh clone, a new machine, and a change of maintainer.

## Pre-PR review

> **IMPORTANT. Follow this exactly.** When the implementation is complete and
> committed and you are about to push or open a PR:
>
> 1. **Review once.** Load `/gatewaze-skills:review-round` with the Skill tool
>    and follow it. It pins the branch range as two SHAs, launches the
>    reviewers in parallel in the background, and tells you how to judge their
>    reports. Land all accepted findings in exactly one fix commit with the
>    subject prefix `fix(review):`, or no commit if there is nothing to fix.
>    The skill then writes the review stamp the push gate checks. Do not work
>    from memory. Load the skill before launching the reviewers.
> 2. **Preflight.** Run `/gatewaze-skills:preflight` and make it pass. It is
>    deterministic checks, not a review. Fix what it reports in its own
>    commit(s) with the subject prefix `fix(preflight):`, as many as it takes,
>    and rerun it. Never rerun the reviewers.
> 3. **Push and open the PR.** From then on there are no local reviews of any
>    kind. Iterate only on CI and on the PR's bot and human feedback, still
>    running tests and checks.

- Knowledge base: `docs/reviews/knowledge-base/`, routed by its `README.md`,
  with `known-false-positives.md` applied last. The reviewers read it. Keep it
  current.
- Preflight: `/gatewaze-skills:preflight`
- Emergency bypass: `GW_REVIEW_SKIP=1` on the push command skips the gate. It is
  for humans and emergencies. Say so explicitly when you use it, and note that
  CI still runs every check.

## The push and CI gates

- A **blocking pre-push hook** (`.husky/pre-push`) runs a deterministic gate
  before anything reaches the remote: a gitleaks secret scan over the commits
  being pushed, plus the shell-call audit. It requires `gitleaks` installed
  locally (`brew install gitleaks`). Do not routinely bypass it with
  `--no-verify`; if you must in a real emergency, say so explicitly and note
  that CI will still run both checks.
- CI (`.github/workflows/`) runs the full matrix: typecheck, lint, tests,
  `pnpm audit`, the shell-call audit, pgTAP RLS tests, CodeQL, gitleaks, and
  OpenSSF Scorecard. Green CI is required to merge.

Both hooks in this section apply to everyone. The two plugin hooks above apply
only to Claude Code sessions, so a person committing from a terminal still
relies on these and on CI.

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
- Never use `GW_REVIEW_SKIP=1` or `--no-verify` without saying so in the same
  message, and never write the review stamp by hand.
- Never run a local review once the PR is open. Work the PR's feedback instead.

## Setup for a fresh clone

Trust the workspace in Claude Code and the `gatewaze-skills` and `pragma`
plugins auto-install from committed `.claude/settings.json`. Then:

- `brew install gitleaks` (required by the pre-push hook).
- `pnpm install` (installs husky hooks via the `prepare` script).
- `git config commit.gpgsign true` and sign off commits (DCO) — see
  `CONTRIBUTING.md`.
- If a `/gatewaze-skills:*` skill named in this file does not load, the local
  plugin copy is stale. Run `/plugin marketplace update gatewaze-skills`.

See `SECURITY.md` for how to report a vulnerability.
