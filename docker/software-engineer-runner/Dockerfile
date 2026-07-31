# Software Engineer runner Dockerfile  (spec: gatewaze/docs/spec-software-engineer.md §7.5, §17)
#
# A SPECIALIST image for the software-engineer module's agent phases — deliberately NOT the
# standard worker image. It is the security boundary of isolation model B: this deployment
# carries ONLY software-engineer secrets and runs ONLY the `software-engineer` queue, so a
# prompt-injected or buggy agent (whose Bash/Edit tools have container-wide reach) cannot
# exfiltrate platform/other-brand secrets, and a crash can't take down the main worker.
#
# vs docker/worker/Dockerfile: NO Chromium, NO Goose, NO Puppeteer, NO Python/uv. It adds
# @anthropic-ai/claude-agent-sdk and a baked, minimal CLAUDE_CONFIG_DIR with only the pinned
# plugins. It is intentionally lean: the authoritative CI gate is each target repo's own GitHub
# required checks (§10.3), so we do NOT bake per-repo language toolchains here.

# ---- Stage 1: Build @gatewaze/shared ----
# Module job handlers transitively import @gatewaze/shared/modules (e.g. encryptSecret for
# credential decryption). Mirror the worker/api pattern: build packages/shared/dist here and
# copy + symlink it into the runtime image so Node's resolver finds it from cloned module code.
FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app
COPY package.json tsconfig.json ./
RUN printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-se-runner,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --filter @gatewaze/shared...
COPY packages/shared/ packages/shared/
RUN pnpm --filter @gatewaze/shared build

# ---- Stage 2: Runtime ----
FROM node:22-slim
ENV NODE_ENV=production

# git: entrypoint clones the module repo + the runner clones/worktrees target repos.
# openssh-client: git push over ssh deploy keys where a brand uses them.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Core worker deps (same job-worker entrypoint as the standard worker) + the Agent SDK.
COPY scripts/package.json scripts/package-lock.json ./
RUN npm ci
RUN npm install --no-save @anthropic-ai/claude-agent-sdk@^0.3.220

# @gatewaze/shared built above → resolvable from cloned module code (ESM walks up from the
# module's mounted path, so a node_modules must sit in an ancestor dir).
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist
COPY --from=builder /app/packages/shared/package.json /app/packages/shared/package.json
RUN ln -sfn /app/node_modules /node_modules

# ---- Baked CLAUDE_CONFIG_DIR (the pinned plugin set) ----
# The M0 spike proved plugin skills (pragma, adversarial-spec) load only at `user` scope from a
# CLAUDE_CONFIG_DIR — so we bake a dedicated minimal one containing ONLY the repo-pinned plugins,
# never the operator's ~/.claude. settingSources:['user','project'] then loads exactly the
# repo's intended toolset.
#
# TODO(finalize): install the pinned plugins into /opt/se-claude at build time. Approach:
#   1. Clone the committed gatewaze-skills marketplace at its pinned commit (and pragma@<SHA>,
#      adversarial-spec) — the exact SHAs come from the repo's committed .claude/settings.json.
#   2. Materialise them into /opt/se-claude/plugins/cache/<marketplace>/<plugin>/<version>/ to
#      match the CLI's on-disk plugin-cache layout (verified shape from the M0 probe:
#      ~/.claude/plugins/cache/agent-pragma/pragma/3.2.3, .../adversarial-spec/adversarial-spec/1.0.0).
#   3. Write /opt/se-claude/settings.json enabling those plugins.
# This is the one build step to validate against the current plugin-cache format before shipping.
ENV CLAUDE_CONFIG_DIR=/opt/se-claude
RUN mkdir -p /opt/se-claude/plugins/cache
# COPY / clone-and-install steps go here once the plugin-cache format is pinned.

# Same entrypoint the api/worker images use: clones MODULE_SOURCES into /tmp/module-repos and
# symlinks them under / before CMD, so `import '/gatewaze-modules/modules/software-engineer/...'`
# resolves. The runner only needs the module repo(s) that provide software-engineer.
COPY docker/api/entrypoint.sh /docker-entrypoint.sh
COPY docker/shared/aggregate-module-deps.mjs /docker/shared/aggregate-module-deps.mjs
RUN chmod +x /docker-entrypoint.sh && mkdir -p /tmp/module-repos

# Scoped runtime (set by the deployment, NOT baked):
#   GATEWAZE_SECRETS_KEY            decrypt brand creds (§4)
#   REDIS_URL                      the BullMQ connection
#   DATABASE_URL / SUPABASE_*      a LEAST-PRIVILEGE role limited to se_* tables — NOT the
#                                  platform service-role key, NOT other modules' tables
#   MODULE_SOURCES                 the module repo(s) to clone at entrypoint
#   WORKER_CONCURRENCY_SOFTWARE_ENGINEER_SOFTWARE_ENGINEER  per-pod concurrency (default 1)
# The MAIN worker deployment sets that concurrency var to 0 so SE jobs run ONLY here.

ENTRYPOINT ["/docker-entrypoint.sh"]
# CMD runs the standard job-worker; env scopes it to the software-engineer queue.
CMD ["node", "packages/api/dist/workers/job-worker.js"]
