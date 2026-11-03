# Worktree dev flow — keep `main` pristine, test branches locally

This is the recommended way to develop and locally test Gatewaze changes without
the two problems we kept hitting:

1. **Cross-checkout collisions.** Uncommitted feature work sat in the primary
   checkout (or leaked between it and a scratch checkout) and got orphaned,
   because "switching branches to test" meant `git checkout` in the one working
   copy that is supposed to stay clean.
2. **Non-reproducible local Docker.** The dev stack bind-mounts the primary
   checkout, so whatever branch (and whatever uncommitted edits) that checkout
   happened to have is what ran.

The fix: **the primary checkout only ever holds `main` and is never hand-edited.
Every feature gets its own git worktree + branch. You point the Docker dev stack
at whichever worktree you're testing.**

## Why local Docker cares about this

The dev stack (`./dev.sh …` → `docker/docker-compose.yml` + `docker-compose.dev.yml`)
is **path-based, not branch-based**. It bind-mounts host directories into the
containers:

- `../packages/*/src` → the **platform** checkout
- `../../gatewaze-modules`, `../../lf-gatewaze-modules` → the **module** checkouts

A container runs *whatever is on disk at that path right now*, regardless of git
branch. (The git-clone / re-clone model — the `.gatewaze-modules` cache — is the
**prod/k8s** path, for modules whose `gatewaze.config` source is a git URL. Local
dev bypasses it via the bind mount.) So a worktree is a *different directory* the
mount doesn't point at — which is why testing a module worktree needs one env var.

## One-time setup

```sh
# alias the helper (add to ~/.zshrc or ~/.bashrc)
alias wt='/Users/you/Git/gatewaze/gatewaze/scripts/wt.sh'
```

## Everyday flow

```sh
# 1. Spin up a worktree for a feature (primary checkout stays on main)
wt new my-feature                 # → ../gatewaze-modules-wt-my-feature on feat/my-feature
cd ../gatewaze-modules-wt-my-feature

# 2. (module work only) point the dev stack at this worktree
wt test my-feature                # prints the line to add to gatewaze/docker/.env:
#   GATEWAZE_MODULES_PATH=../../gatewaze-modules-wt-my-feature
cd ../gatewaze && ./dev.sh restart api worker

# 3. Edit + commit in the worktree. Root your editor / Claude Code session HERE.

# 4. See what's dirty across every worktree at any time
wt list

# 5. When done (merged), remove it
wt rm my-feature                  # prompts to delete the branch too
# and point docker/.env back: unset GATEWAZE_MODULES_PATH (or = ../../gatewaze-modules)
```

`wt` commands: `new <name> [base]`, `list` / `status`, `rm <name>`, `test <name>`.
`<name>` is validated (`^[a-z0-9][a-z0-9-]{0,40}$`) since it becomes a branch and a path.

## Platform vs module worktrees

- **Module work** (`gatewaze-modules`, `lf-gatewaze-modules`): the mount points at
  a fixed sibling path, so you *must* set `GATEWAZE_MODULES_PATH` /
  `LF_GATEWAZE_MODULES_PATH` (in `docker/.env`) to the worktree. `wt test` prints
  the exact line. Only one module worktree is "live" at a time (the stack is
  single-brand — container names are `${COMPOSE_PROJECT_NAME}-*`), which matches
  testing one feature at a time.
- **Platform work** (`gatewaze`): the compose file travels *with* the worktree, so
  running `./dev.sh` from inside a platform worktree already mounts that worktree's
  `../packages/*`. (Its `../../gatewaze-modules` mount still resolves to the primary
  module checkout — combine with `GATEWAZE_MODULES_PATH` if you need both.)

## Reload semantics after pointing at a worktree

- **admin / portal**: hot-reload (Vite polling is forced in-container).
- **api / worker / scheduler**: run `tsx watch`, but **server-side module edits
  often need** `./dev.sh restart api worker` (or `docker restart <project>-api`
  / `-worker`) to be picked up.

## Guardrail

A **soft** `.husky/pre-commit` warning fires when you commit directly on `main`
(set `WT_ALLOW_MAIN=1` to silence a deliberate one). It never blocks — it just
nudges the "work in a worktree" habit so `main` and the Docker mount stay clean.
