#!/usr/bin/env bash
#
# wt — git worktree helper for the "keep main pristine, work in worktrees" flow.
#
# Every feature gets its own worktree + branch so the primary checkout only ever
# holds `main` and is never hand-edited. That keeps the local Docker dev stack
# (which bind-mounts the primary checkout) reproducible, and stops uncommitted
# feature work leaking between working copies. See docs/worktree-dev-flow.md.
#
# Usage (alias it: `alias wt='<repo>/scripts/wt.sh'`):
#   wt new <name> [base]   Create ../<repo>-wt-<name> on branch feat/<name>
#                          from <base> (default origin/main). Prints the path.
#   wt list                List every worktree with its branch + dirty state.
#   wt status              Alias for list (shows uncommitted work across worktrees).
#   wt rm <name>           Remove the ../<repo>-wt-<name> worktree (prompts to
#                          also delete the feat/<name> branch).
#   wt test <name>         Print the GATEWAZE_MODULES_PATH line to point the dev
#                          stack at this worktree (for module-repo worktrees).
#
# <name> must match ^[a-z0-9][a-z0-9-]{0,40}$ (it becomes a branch and a path)
# and <base> must be a plain ref with no leading '-' or spaces — both are
# validated before reaching git, never interpolated raw. The <base> check is
# security-critical: git's fetch/clone honour `--upload-pack=<cmd>`, which shells
# out even for a single quoted argument (see valid_base).

set -euo pipefail

die() { printf 'wt: %s\n' "$1" >&2; exit 1; }

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"

# The PRIMARY worktree is the first entry in `git worktree list --porcelain`.
primary="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
parent="$(dirname "$primary")"
repo="$(basename "$primary")"

valid_name() {
  case "$1" in
    *[!a-z0-9-]* | '' ) return 1 ;;         # only lowercase, digits, hyphen
    [!a-z0-9]* ) return 1 ;;                # must start alphanumeric
    * ) [ "${#1}" -le 41 ] ;;               # length cap
  esac
}

# Validate a base ref (branch / remote-branch / SHA) before it reaches git.
# CRITICAL: a leading '-' must be rejected — git's fetch/clone transport honours
# `--upload-pack=<cmd>` (and similar), which SHELLS OUT even when the value is
# passed as a single quoted argument. So `origin/--upload-pack=touch x` would run
# arbitrary commands. Restricting to a safe ref charset with no leading dash and
# no whitespace closes that gadget.
valid_base() {
  case "$1" in
    -* | *[!A-Za-z0-9._/-]* | '' ) return 1 ;;
    * ) return 0 ;;
  esac
}

cmd_new() {
  local name="${1:-}" base="${2:-origin/main}"
  valid_name "$name" || die "invalid name '$name' — use ^[a-z0-9][a-z0-9-]{0,40}$"
  valid_base "$base" || die "invalid base ref '$base' — must be a plain ref (no leading '-', no spaces)"
  local path="$parent/$repo-wt-$name" branch="feat/$name"
  [ -e "$path" ] && die "path already exists: $path"
  # Refresh the base ref if it is a remote-tracking branch, best-effort. `--`
  # ends option parsing so the ref can never be read as a flag (belt-and-braces
  # with valid_base — see its comment re: the --upload-pack shell-out gadget).
  case "$base" in origin/*) git fetch --quiet origin -- "${base#origin/}" 2>/dev/null || true ;; esac
  git worktree add -b "$branch" "$path" -- "$base"
  printf '\n✓ worktree ready: %s  (branch %s)\n' "$path" "$branch"
  printf '  cd %q\n' "$path"
  case "$repo" in *modules*) printf '  to test it in Docker:  wt test %s\n' "$name" ;; esac
}

cmd_list() {
  printf '%-52s %-34s %s\n' "WORKTREE" "BRANCH" "STATE"
  # -z-safe iteration over porcelain records.
  local wt="" br=""
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt="${line#worktree }" ;;
      "branch "*)   br="${line#branch refs/heads/}" ;;
      "detached")   br="(detached)" ;;
      "")  # end of a record
        # skip ephemeral agent worktrees (Claude Code isolation), not part of this flow
        if [ -n "$wt" ] && [[ "$wt" != */.claude/worktrees/* ]]; then
          local state="clean"
          if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then state="DIRTY (uncommitted)"; fi
          printf '%-52s %-34s %s\n' "$wt" "${br:-?}" "$state"
        fi
        wt=""; br="" ;;
    esac
  done < <(git worktree list --porcelain; printf '\n')
}

cmd_rm() {
  local name="${1:-}"
  valid_name "$name" || die "invalid name '$name'"
  local path="$parent/$repo-wt-$name" branch="feat/$name"
  git worktree remove "$path"   # refuses if dirty unless --force; that's intentional
  printf '✓ removed worktree %s\n' "$path"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    printf 'delete branch %s too? [y/N] ' "$branch"; read -r ans
    case "$ans" in [yY]*) git branch -d "$branch" || printf '  (branch not fully merged — use: git branch -D %q)\n' "$branch" ;; esac
  fi
}

cmd_test() {
  local name="${1:-}"
  valid_name "$name" || die "invalid name '$name'"
  local wtname="$repo-wt-$name"
  case "$repo" in
    *modules*) : ;;
    *) die "'wt test' points the module mount at a worktree; run it from a *-modules repo" ;;
  esac
  local var="GATEWAZE_MODULES_PATH"
  case "$repo" in lf-*|*lf-gatewaze-modules) var="LF_GATEWAZE_MODULES_PATH" ;; esac
  cat <<EOF
Add this to gatewaze/docker/.env (path is relative to that docker/ dir), then
restart the stack so the api + worker re-read the module source:

  $var=../../$wtname

  ./dev.sh restart api worker

Primary checkout stays on main; the dev stack now serves this worktree. Unset
the line (or point it back to ../../$repo) to return to the primary checkout.
EOF
}

case "${1:-}" in
  new)          shift; cmd_new "$@" ;;
  list|status)  shift; cmd_list ;;
  rm|remove)    shift; cmd_rm "$@" ;;
  test)         shift; cmd_test "$@" ;;
  ''|-h|--help)
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *) die "unknown command '$1' (try: new, list, rm, test)" ;;
esac
