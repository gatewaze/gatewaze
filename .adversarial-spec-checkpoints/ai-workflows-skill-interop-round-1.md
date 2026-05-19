# Spec: AI Workflows + Skill Interop (Goose / Claude Code / agentskills.io)

**Status:** v0 draft for adversarial review
**Owner:** `@gatewaze-modules/ai`
**Depends on:** `spec-ai-module.md`, `spec-ai-skills.md`

---

## 1. Overview / Context

The Gatewaze AI module currently supports one execution mode: a single model call (via `runChat()`) optionally augmented by a markdown "skill" loaded from a registered git repository. Skills today are a Gatewaze-proprietary shape — any `.md` under a configured `path_prefix` becomes a skill, frontmatter fields are Gatewaze-named (`applies_to`, `tags`, `reference_images`).

Two adjacent ecosystems have converged on the **agentskills.io** open standard for skill files (directory-as-skill, canonical `SKILL.md`, frontmatter with `name` + `description` + `metadata`):

- **Claude Code** — Anthropic's CLI. Reads from `~/.claude/skills/<name>/SKILL.md` and project `.claude/skills/`. Extends agentskills.io with CLI-specific frontmatter (`disable-model-invocation`, `arguments`, `paths`, `context: fork`, etc.) and runtime injection primitives (`` !`<command>` `` shell-output substitution, `$ARGUMENTS`, `${CLAUDE_…}` env vars).
- **Goose** (Block / example-goose fork) — Open-source MCP agent. Walks `~/.agents/skills/`, `~/.claude/skills/`, `~/.config/agents/skills/`, project `.agents/skills/`, `.goose/skills/`, `.claude/skills/`. Goose is *intentionally* cross-compatible with Claude Code's skill directory.
- **Goose recipes** — Reusable YAML workflows that chain multiple model invocations through `sub_recipes`. Each (sub-)recipe has its own `settings.goose_provider` + `goose_model`, so a recipe can express adversarial chains (model A produces → model B critiques → model A revises).

The team uses Goose and Claude Code locally. They want to author skills + recipes in those environments and **run the same files** in Gatewaze without modification — preserving the unified cost ledger, credential resolution, and per-use-case daily caps that the AI module already enforces server-side.

This spec defines:

1. The Gatewaze-side **skill file format and discovery rules**, conforming to agentskills.io.
2. The **Goose recipe runner** (an adapter that loads a Goose recipe YAML and executes it via `runChat()` / `aiEmbed()` so cost + credentials + quotas flow through unchanged).
3. The **extension portability tiers** — which Claude Code and Goose runtime features are honoured, ignored, or refused.

The existing skills implementation is **not in production use** (zero rows in `ai_skill_sources` across deployments at spec drafting time), so this spec replaces it rather than migrating it.

## 2. Goals and Non-Goals

### Goals

1. **One file format for skills across all three runtimes.** A skill file written for Claude Code (`.claude/skills/<name>/SKILL.md`) runs unmodified in Goose desktop and in Gatewaze, with no author-visible compromise on the spec-conforming subset.
2. **One file format for workflows across Goose and Gatewaze.** A Goose recipe YAML authored locally runs in Gatewaze when its features fall within the supported portability tier, with no semantic divergence between the two environments.
3. **Provider router + cost ledger + per-use-case caps stay authoritative.** Recipe execution and skill resolution both flow through the same `runChat()` and `recordUsage()` paths used by every other AI surface in Gatewaze. There is no second cost ledger, no second credential resolver, no parallel observability surface.
4. **Explicit portability tiers.** Every runtime-specific feature (Claude Code's `disable-model-invocation`, Goose recipes' `inline_python` extension) is classified into one of three tiers — **honoured**, **ignored**, **refused-with-warning**. Tiers are documented in the operator UI so authors know what works.
5. **Operator visibility into incompatibility.** When a skill or recipe is refused, the reason is surfaced on the source row (`sync_status='warning'`) with a structured list of unsupported features and per-file references.

### Non-Goals

- **Sandboxed shell execution** for Claude Code's `` !`<command>` `` injection primitive. Out of scope for v1; treated as a Tier-3 refusal.
- **Stdio MCP server bundling** beyond a small operator-controlled allowlist (`github-mcp`, `slack-mcp`, `postgres-mcp`). Arbitrary `stdio` extensions with operator-supplied `cmd:` values are refused.
- **`inline_python` Goose extension support.** Requires a real sandbox (Pyodide, gVisor, Firecracker); out of scope.
- **Filesystem/shell-heavy platform extensions** (Goose `developer`, `analyze`, `summarize`, `apps`). Recipes that depend on these refuse at validation time; they remain Goose-desktop-only.
- **Resource-file loading at runtime** (`SKILL.md` siblings under `references/`, `scripts/`, `assets/`). v1 records resource paths on the indexed row but does not yet load them on demand. Deferred to a Tier-2 follow-on.
- **Progressive disclosure** (loading `name + description` separately from skill body). v1 loads full bodies into the prompt budget; revisited when skill count > 20 per use-case.
- **Argument binding** for skills (`$ARGUMENTS`, `arguments:` frontmatter). v1 refuses skills that depend on these.
- **Backwards compatibility with the existing Gatewaze skill schema.** No production usage; clean replacement.

## 3. System Architecture

### 3.1 Component topology (no new services)

The work lives entirely inside `@gatewaze-modules/ai`. Three new logical components, all in-process:

1. **Skill discovery + parser** — replaces `lib/skills/frontmatter.ts` and the walk in `lib/skills/sync-source.ts`. Reads `SKILL.md` files only; treats sibling files as resources, not skills.
2. **Recipe parser + executor** — new `lib/recipes/` directory. Loads Goose recipe YAML, validates against the portability tier, dispatches sub-recipes via recursive `runChat()` calls.
3. **Portability validator** — shared module used by both the skill parser and recipe parser to classify frontmatter / settings fields as Tier 1 / 2 / 3 (honour / ignore / refuse).

The sync worker (`workers/sync-skill-sources.ts`) is unchanged in its claim-the-lock / clone-or-fetch / walk / upsert outer loop; only the parser and the discovery walk change.

### 3.2 Skill file discovery

A skill is a **directory** containing `SKILL.md`. The sync worker walks the cloned repo from `path_prefix`, and for each directory containing a `SKILL.md`:

- That `SKILL.md` is indexed as one skill row in `ai_skills`.
- Sibling files (regardless of whether they live under `references/`, `scripts/`, `assets/`, or the root) are recorded as resource paths on the skill row (`resources jsonb`). Bodies are not loaded.
- The walk does **not** descend further from that directory. A skill cannot contain a nested skill.

Directories that don't contain `SKILL.md` are walked recursively for child directories. Loose `.md` files (no surrounding `SKILL.md` directory) are ignored.

### 3.3 Recipe file discovery

Recipes are **not stored in the same git source as skills**. Two separate concerns:

- A new `ai_recipe_sources` table parallels `ai_skill_sources`. Same auth/secret/webhook plumbing, different content type.
- Discovery walks for `*.yaml` files containing the required Goose recipe top-level fields (`title` + `instructions`). Files lacking these fields are skipped silently.
- Each recipe upserts one row in a new `ai_recipes` table.

Recipes can reference skills (a recipe can mention skill names in its `instructions`), and skills can be invoked by recipes (the recipe runner resolves skill references against the `ai_skills` table). The two tables are independent but cross-referenceable.

### 3.4 Recipe execution flow

```
admin user / cron / api caller
        │
        ▼
runRecipe(supabase, ctx, { recipe_id | recipe_yaml, params })
        │
        ├─→ validateRecipe()  (portability tier check; reject Tier-3)
        ├─→ bindParameters(recipe, params)
        ├─→ for each step (recipe + sub_recipes):
        │      ├─→ resolveModel(step.settings.goose_provider, .goose_model)
        │      │        └─→ provider router  (existing)
        │      ├─→ runChat(...)             (existing)
        │      │        └─→ recordUsage()   (existing — cost ledger)
        │      └─→ collect step output, thread into next step's input
        │
        └─→ returns final structured-output result + per-step audit
```

Sub-recipes execute in declared order unless `sequential_when_repeated: false` is explicit and `values` produce a list (then they fan out in parallel via `Promise.allSettled`, bounded by `MAX_RECIPE_FANOUT` = 5).

A recipe run produces one row in a new `ai_recipe_runs` table that holds the input parameters, the timeline of `ai_usage_events` it produced (via foreign-key reference), and the final structured output. This is the audit primitive — equivalent to `ai_threads` for chat workflows.

## 4. Component Design

### 4.1 Skill parser (`lib/skills/parse-skill.ts`)

Spec-conforming parser. Strict — refuses non-conforming files rather than coercing.

**Inputs:** `(skillDirPath: string, skillMdRaw: string, siblingFiles: string[])`

**Required validation:**

- Frontmatter contains `name` (string, `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, ≤ 64 chars, must equal `basename(skillDirPath)` exactly).
- Frontmatter contains `description` (string, ≤ 1024 chars, non-empty after trim).
- Frontmatter `metadata` (if present) is a flat `Record<string, string | number | boolean>`. Nested objects are rejected (per agentskills.io: "A map from string keys to string values").
- Body is non-empty after trim.

**Tier-2 fields (silently accepted, persisted on row, ignored at runtime):**

- `license` (string, ≤ 500)
- `compatibility` (string, ≤ 500)
- `allowed-tools` (string or string[]; intersected with the use-case's `allowed_web_tools` at runtime — Tier-1 behaviour where it overlaps)
- `when_to_use` (string; concatenated with `description` in the skill-listing summary)
- `paths` (string or string[]; persisted as `metadata.paths` for future host-kind filtering)
- All Claude Code interactive-CLI fields: `disable-model-invocation`, `user-invocable`, `argument-hint`, `model`, `effort`, `context`, `agent`, `hooks`, `shell`

**Tier-3 fields (refuse; record reason):**

- Body contains `` !`<...>` `` or ` ```! ` blocks (shell injection)
- Body contains `$ARGUMENTS`, `$N` shorthand, or `$<name>` substitution
- Body contains `${CLAUDE_<…>}` or `${GOOSE_<…>}` env substitutions
- Frontmatter contains `arguments` field (positional-arg binding)

**Output:**

```ts
type ParsedSkill =
  | { ok: true; skill: SkillRow; warnings: string[] }
  | { ok: false; reason: 'refused'; refusal: UnsupportedFeature[] }
  | { ok: false; reason: 'parse_error'; message: string };

interface UnsupportedFeature {
  feature: 'shell-injection' | 'argument-substitution' | 'env-substitution' | 'arguments-field';
  location: { line: number; col: number; snippet: string };
}
```

### 4.2 Recipe parser (`lib/recipes/parse-recipe.ts`)

**Inputs:** `(recipeYamlPath: string, recipeYamlRaw: string)`

**Required validation:**

- `title` (string, ≤ 200 chars).
- `instructions` (string, non-empty) — becomes the system prompt for the recipe's primary step.
- `parameters` (optional array). Each parameter: `key` (string, identifier), `input_type` ∈ `{string, number, boolean, date, select}`, `requirement` ∈ `{required, optional, user_prompt}`. `file` input type is refused (no filesystem at runtime). `user_prompt` is treated as `required` (Gatewaze has no interactive prompt surface).
- `settings.goose_provider` ∈ `{anthropic, openai, gemini}` (`auto` is honoured). `goose_model` is resolved against `ai_model_prices` — unknown model rejected.
- `response.json_schema` (optional) — used as the runner's `structuredTool.inputSchema`.
- `sub_recipes` (optional array). Each sub-recipe path is resolved relative to the parent recipe's directory; cycles detected (parent + ancestors tracked) and refused.
- `extensions` — see §4.3 (portability matrix).

**Output:** mirrors `ParsedSkill`'s discriminated-union shape.

### 4.3 Extension portability matrix

Implemented as a single map in `lib/recipes/extension-tiers.ts`:

| Extension type | Tier | Behaviour |
|---|---|---|
| **No `extensions` block** | 1 | Runs |
| `streamable_http` | 1 | MCP client connects to the recipe-declared URL. Per-environment URL substitution via `${GATEWAZE_*}` variables (resolved server-side, never echoed to the model). Requests time out at `MCP_HTTP_TIMEOUT_MS` (default 30s). |
| `stdio` with `cmd` in operator allowlist | 2 | Allowed binaries: `github-mcp`, `slack-mcp`, `postgres-mcp` (initial set). Operator declares the allowlist + per-binary env mapping in `config/ai-recipes.yaml` at module install time. |
| `stdio` with arbitrary `cmd` | 3 | Refused. |
| Anthropic native `web_search` | 1 | Mapped to the existing runner's `web_search` web-tool (already implemented). |
| `fetch_url` MCP | 1 | Mapped to the existing runner's `fetch_url` web-tool. |
| `gatewaze_search` MCP | 1 | Mapped to the existing runner's `gatewaze_search` web-tool (Serper/DDG). |
| `builtin: memory` (Goose) | 2 | Mapped to a new `ai_recipe_memory` table (per-recipe-run KV). |
| All other Goose `builtin` (`autovisualiser`, `computercontroller`, `peekaboo`, `tutorial`) | 3 | Refused — desktop/UI-coupled. |
| Goose `platform` extensions (`developer`, `analyze`, `apps`, `summarize`, `code_execution`, `orchestrator`, `tom`, `chatrecall`, `extensionmanager`, `summon`, `todo`) | 3 | Refused for v1. Some (`chatrecall`, `todo`, `tom`) are flagged for future server-side implementation; the rest are inherently desktop or filesystem-heavy. |
| `inline_python` | 3 | Refused — no sandbox in v1. |
| `frontend` | 3 | Refused — browser-coupled. |

### 4.4 Parameter binding

Recipe parameters bind into the recipe body via Jinja-style `{{ param_name }}` substitution **at parse time, before the recipe ever reaches a model**. Substitution rules:

- Only declared parameters from the `parameters:` array are substitutable. Unknown `{{ ... }}` references parse-fail.
- Substituted values are escaped: newlines preserved, but `{{`, `}}`, backticks, and `${` sequences in user-supplied parameter values are stripped (prevents indirect injection).
- Caller of `runRecipe()` supplies a `Record<string, string | number | boolean | Date>`. `select` parameters validate value is in the recipe's `options:` array. `required` parameters with missing values reject the run before any LLM call is made.

Sub-recipes receive parameters via `values:` declared in the parent's `sub_recipes` array. Sub-recipe parameters that aren't in `values` and are `required` reject the run.

### 4.5 Cross-runtime authoring contract

A team writes one repo containing both skills and recipes:

```
ai-content/
├── .claude/skills/            # Discovered by Claude Code, Goose, and Gatewaze
│   └── example-brand-voice/
│       ├── SKILL.md
│       └── references/
│           └── tone-examples.md
└── recipes/                   # Goose recipe runner + Gatewaze recipe runner
    ├── weekly-newsletter.yaml
    └── adversarial-research.yaml
```

The skills repo and the recipes repo can be the same repo (Gatewaze indexes both) or separate (one source row per content type). The skill `name` matches the parent directory name exactly (spec invariant — easier discovery and unambiguous addressability).

## 5. API Design

### 5.1 New REST endpoints (admin-only)

All mounted under `/api/modules/ai/admin/`, JWT-gated, same auth model as existing endpoints.

#### Recipe sources

```
GET    /recipe-sources                  → list
POST   /recipe-sources                  → create   { label, git_url, branch?, path_prefix?, auth_token? }
GET    /recipe-sources/:id              → detail
PATCH  /recipe-sources/:id              → update   { label?, branch?, path_prefix? }
DELETE /recipe-sources/:id              → delete
POST   /recipe-sources/:id/sync         → enqueue sync job

GET    /recipes                         → list (across all sources)   ?source_id&search&limit&offset
GET    /recipes/:id                     → detail (full YAML + parsed)
```

Identical request/response envelope and error codes as the existing `ai_skill_sources` surface. Response payloads carry `parse_status: 'ok' | 'refused' | 'parse_error'` and `unsupported_features: UnsupportedFeature[]` so the admin UI can show what failed.

#### Recipe runs

```
POST   /recipes/:id/run                 → kick off a run
                                          body: { params, host_kind?, host_id? }
                                          returns 202 + run_id + initial status
GET    /recipe-runs/:id                 → run detail + per-step audit
DELETE /recipe-runs/:id                 → cancel (if running) / delete (if terminal)
GET    /recipe-runs                     → list   ?recipe_id&user_id&from&to&limit&offset
```

Run-level concurrency cap: `MAX_CONCURRENT_RUNS_PER_USE_CASE` = 3 (configurable). A 4th run for the same use-case returns 429.

### 5.2 Programmatic API (in-module)

```ts
// lib/recipes/run-recipe.ts
export async function runRecipe(
  supabase: SupabaseClient,
  ctx: RecipeContext,
  args: {
    recipe: ParsedRecipe;
    params: Record<string, RecipeParamValue>;
    userId: string | null;
    useCase: string;
    hostKind?: string;
    hostId?: string;
  },
): Promise<RunRecipeResult>;

interface RunRecipeResult {
  run_id: string;
  status: 'complete' | 'failed' | 'cancelled' | 'budget_blocked';
  final_output: Record<string, unknown> | string;
  steps: Array<{ step_id: string; usage_event_id: string; provider: string; model: string; cost_micro_usd: number; }>;
  total_cost_micro_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  duration_ms: number;
}
```

## 6. Data Models / Database Schema

### 6.1 Replace existing `ai_skills` (migration 013)

```sql
-- New columns; old ones removed. No data preserved (zero rows in prod).
DROP TABLE IF EXISTS ai_skills CASCADE;

CREATE TABLE ai_skills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid NOT NULL REFERENCES ai_skill_sources(id) ON DELETE CASCADE,

  -- Per spec: dir name === name. We store both for indexing convenience.
  dir_name        text NOT NULL,
  dir_path        text NOT NULL,             -- full path within repo

  name            text NOT NULL,             -- equals dir_name; validated lowercase-hyphen
  description     text NOT NULL,             -- required, ≤ 1024
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  resources       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- sibling-file relative paths

  body            text NOT NULL,
  body_chars      integer NOT NULL,
  content_hash    text NOT NULL,

  parse_status        text NOT NULL CHECK (parse_status IN ('ok','refused','parse_error')),
  unsupported_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  parse_warnings       jsonb NOT NULL DEFAULT '[]'::jsonb,

  last_commit_sha text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_id, dir_path)
);

CREATE INDEX ai_skills_source_idx ON ai_skills (source_id);
CREATE INDEX ai_skills_parse_status_idx ON ai_skills (parse_status) WHERE parse_status <> 'ok';
CREATE INDEX ai_skills_metadata_gin ON ai_skills USING gin (metadata jsonb_path_ops);
```

### 6.2 Recipe tables (migration 014)

```sql
CREATE TABLE ai_recipe_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label           text NOT NULL,
  description     text,
  git_url         text NOT NULL,
  branch          text NOT NULL DEFAULT 'main',
  path_prefix     text NOT NULL DEFAULT '',
  auth_token_ciphertext text,
  auth_token_last4 text,
  webhook_secret  text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  webhook_provider text NOT NULL DEFAULT 'github' CHECK (webhook_provider IN ('github','gitlab','gitea')),
  last_synced_at  timestamptz,
  last_synced_commit text,
  sync_status     text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','syncing','ok','error')),
  sync_error      text,
  sync_lock_token uuid,
  sync_lock_expires_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id),
  CONSTRAINT ai_recipe_sources_https_only CHECK (git_url LIKE 'https://%'),
  UNIQUE (git_url, branch)
);

CREATE TABLE ai_recipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid NOT NULL REFERENCES ai_recipe_sources(id) ON DELETE CASCADE,
  file_path       text NOT NULL,             -- relative path within repo

  title           text NOT NULL,
  description     text,
  instructions    text NOT NULL,
  parameters      jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_schema jsonb,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  sub_recipe_refs jsonb NOT NULL DEFAULT '[]'::jsonb,  -- resolved paths
  extensions      jsonb NOT NULL DEFAULT '[]'::jsonb,

  parse_status        text NOT NULL CHECK (parse_status IN ('ok','refused','parse_error')),
  unsupported_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  parse_warnings       jsonb NOT NULL DEFAULT '[]'::jsonb,

  content_hash    text NOT NULL,
  last_commit_sha text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_id, file_path)
);

CREATE INDEX ai_recipes_source_idx ON ai_recipes (source_id);
CREATE INDEX ai_recipes_parse_status_idx ON ai_recipes (parse_status) WHERE parse_status <> 'ok';

CREATE TABLE ai_recipe_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id       uuid REFERENCES ai_recipes(id) ON DELETE SET NULL,
  recipe_file_path text,                       -- snapshotted so audit survives recipe deletion
  recipe_content_hash text NOT NULL,           -- ditto

  user_id         uuid REFERENCES auth.users(id),
  use_case        text NOT NULL REFERENCES ai_use_cases(id),
  host_kind       text,
  host_id         text,

  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','complete','failed','cancelled','budget_blocked')),
  failure_reason  text,
  final_output    jsonb,

  total_cost_micro_usd bigint NOT NULL DEFAULT 0,
  total_input_tokens   integer NOT NULL DEFAULT 0,
  total_output_tokens  integer NOT NULL DEFAULT 0,

  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     integer
);

CREATE INDEX ai_recipe_runs_recipe_idx ON ai_recipe_runs (recipe_id);
CREATE INDEX ai_recipe_runs_use_case_started_idx ON ai_recipe_runs (use_case, started_at DESC);
CREATE INDEX ai_recipe_runs_status_idx ON ai_recipe_runs (status) WHERE status = 'running';

CREATE TABLE ai_recipe_memory (
  recipe_run_id   uuid NOT NULL REFERENCES ai_recipe_runs(id) ON DELETE CASCADE,
  key             text NOT NULL,
  value           jsonb NOT NULL,
  written_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_run_id, key)
);

-- ai_usage_events backreference
ALTER TABLE ai_usage_events
  ADD COLUMN IF NOT EXISTS recipe_run_id uuid REFERENCES ai_recipe_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipe_step_index integer;

CREATE INDEX IF NOT EXISTS ai_usage_events_recipe_run_idx
  ON ai_usage_events (recipe_run_id) WHERE recipe_run_id IS NOT NULL;
```

RLS on all new tables follows the same pattern as `ai_skill_sources`: admin-write, admin-read. `ai_recipe_runs` additionally allows the creating user (`user_id`) to read their own rows.

### 6.3 `ai_use_case_recipe_ref` (replaces part of migration 008)

A use-case can optionally pin to a recipe instead of (or in addition to) a skill. New columns on `ai_use_cases`:

```sql
ALTER TABLE ai_use_cases
  ADD COLUMN IF NOT EXISTS recipe_source_id uuid REFERENCES ai_recipe_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipe_file_path text;
```

When set, the use-case's `default_provider`/`default_model` is overridden by the recipe's `settings`. When unset, the existing single-call flow applies.

## 7. Security Considerations

1. **Skill-source / recipe-source git URL allowlist.** `https://` only (enforced by existing CHECK constraint, mirrored on recipe-sources). Operators must register the source URL explicitly; tokens are encrypted via pgsodium (mirror existing pattern).
2. **Parameter substitution injection.** All user-supplied parameter values are stripped of `{{`, `}}`, backticks, `${`, and trailing/leading whitespace runs > 1KB. The recipe body is **substituted at parse time** so the rendered body in `ai_recipe_runs.params` is auditable.
3. **Sub-recipe path traversal.** Sub-recipe paths are resolved relative to the parent recipe's directory; any resolved path that escapes the repo root or the source's `path_prefix` is refused at parse time. Same protection as the skill walk's symlink-out-of-tree defence.
4. **Cycle detection.** Sub-recipe references form a DAG; cycles refused at parse time. `MAX_RECIPE_DEPTH` = 4 (depth, not breadth).
5. **MCP `streamable_http` URL validation.** URLs in `extensions[].uri` must be `https://`. URLs containing `localhost`, `127.0.0.1`, `0.0.0.0`, `metadata.google.internal`, link-local IP ranges, or AWS/GCP/Azure metadata-service hostnames are refused (mirrors SSRF protection in scrapling-fetcher §8.2). All `streamable_http` requests time out at `MCP_HTTP_TIMEOUT_MS` (default 30s); the response body is capped at 256 KiB.
6. **MCP stdio allowlist.** Operator declares allowed binaries in `config/ai-recipes.yaml` with absolute paths. Recipe-declared `cmd:` must match a configured allowlist entry exactly (no path tricks). Per-binary env mapping is operator-controlled — recipes cannot smuggle env vars in.
7. **Run-level budget gate.** Before any LLM call, the runner sums the use-case's `daily_cost_cap_micro_usd` against today's `ai_usage_events` for that use-case (including in-flight recipe runs' accumulated cost). A recipe whose worst-case estimate exceeds the cap is rejected with `budget_blocked`. Existing `estimateMaxCost()` is the building block; the recipe runner stacks per-step worst-cases.
8. **Per-user rate limit.** 10 recipe runs per user per minute, enforced at the API layer using the existing rate-limit primitive.
9. **Recipe-run cancellation.** Long-running recipes (multi-step, multi-minute) are cancellable. The runner checks `ai_recipe_runs.status = 'cancelled'` between steps and aborts before the next provider call.
10. **Audit-log immutability.** `ai_usage_events` rows are never updated after insert; the recipe-run-id backreference is set on insert. `ai_recipe_runs.params` is also immutable post-completion (enforced by RLS — no UPDATE policy after `completed_at IS NOT NULL`).

## 8. Error Handling Strategy

| Failure mode | Behaviour | Surface |
|---|---|---|
| Skill `parse_error` (malformed YAML) | Row written with `parse_status='parse_error'`, full body still stored, runtime refuses to load body | Sync result + admin UI red badge |
| Skill `refused` (Tier-3 feature) | Row written with `parse_status='refused'` + `unsupported_features`, body stored, runtime refuses to load | Sync result + admin UI amber badge with feature list |
| Recipe `parse_error` | Same as skill | Sync result + admin UI |
| Recipe `refused` | Same as skill | Sync result + admin UI |
| Run parameter missing/invalid | 400 before any LLM call; no `ai_recipe_runs` row written | API error response |
| Step provider error (rate limit, timeout) | Same retry behaviour as `runChat()` (exponential backoff, max 3 attempts). After exhaustion, `ai_recipe_runs.status='failed'` + `failure_reason` | Run detail endpoint + sync events |
| Step structured-output validation failure | `ai_recipe_runs.status='failed'` with `failure_reason='structured_output_invalid: <details>'` | Run detail |
| Sub-recipe missing (deleted between parse and run) | `failed` with `failure_reason='sub_recipe_missing: <path>'` | Run detail |
| Budget cap hit mid-recipe | `status='budget_blocked'` after the failing step. Partial output preserved in `final_output.partial` | Run detail |
| Cancelled via DELETE | `status='cancelled'`. Step in flight at cancel time is allowed to complete (so cost accounting stays accurate); next step never starts | Run detail |
| MCP streamable_http server unreachable | Step `failed` with `failure_reason='mcp_unreachable: <uri>'`; no retry (assumes operator misconfiguration) | Run detail |

## 9. Performance Requirements / SLAs

- **Skill / recipe sync** completes within 60s for a repo with ≤ 200 skill directories + ≤ 100 recipes (one git fetch + one walk).
- **Recipe run launch (HTTP POST → 202)** within 200ms p95 (no LLM call yet; just validates params + writes the `ai_recipe_runs` row + enqueues).
- **Per-step LLM latency** matches existing `runChat()` SLAs — no recipe-layer overhead added.
- **Recipe fanout cap.** `MAX_RECIPE_FANOUT` = 5 concurrent sub-recipe executions per parent step (`Promise.allSettled` bounds the spike against per-use-case daily caps).
- **Total recipe duration cap.** `MAX_RECIPE_DURATION_MS` = 30 minutes — beyond which the runner kills the run as `failed` with `failure_reason='timeout'`.
- **Recipe-run table volume.** Each run writes 1 row + N `ai_usage_events` rows (one per step). At 100 runs/day across the platform, retention plan: hot for 90 days, archive `final_output` to JSONB-compressed cold storage after 90 days. (Bigger volume needs partitioning; revisit at >1k/day.)

## 10. Observability

1. **Per-run timeline UI.** New admin tab `/admin/ai → Recipe runs`. Lists recent runs with status, duration, total cost, step count. Drill-down shows per-step usage event with provider/model/cost.
2. **Cost dashboard integration.** `ai_recipe_runs` totals roll up into the existing AI usage daily chart with a `kind='recipe'` filter slicer added to the breakdown.
3. **Structured logs.** Each step emits `ai.recipe.step.{start,complete,failed}` with `run_id, step_index, provider, model, cost_micro_usd, duration_ms`. Parse failures emit `ai.recipe.parse.{refused,error}` with the recipe path and feature list.
4. **Metrics.** Counters: `ai_recipe_runs_started_total{use_case, status}`, `ai_recipe_steps_total{provider, model, status}`, `ai_recipe_parse_refused_total{feature}`. Histograms: `ai_recipe_duration_ms{use_case}`, `ai_recipe_cost_micro_usd{use_case}`.
5. **Skill discovery diagnostics.** The existing `ai_skill_source_webhook_log` model extends to `ai_recipe_source_webhook_log` for symmetry.

## 11. Testing Strategy

1. **Unit tests** (vitest, per existing module convention):
   - Skill parser: 20+ cases covering all Tier-3 refusal triggers, name-validation edge cases, `metadata` shape rejection, dir-name mismatch.
   - Recipe parser: 30+ cases covering parameter binding, sub-recipe path resolution + cycle detection, extension-tier classification, settings validation.
   - Parameter binding: golden-test against ≥ 50 input/output pairs (including injection attempts).
   - Extension matrix: every row in §4.3's table is one test case.
2. **Integration tests** (against a real Supabase test DB):
   - End-to-end recipe run with one step (no sub-recipes).
   - End-to-end recipe run with one parent + two sub-recipes, different models per sub-recipe.
   - Recipe run with `streamable_http` extension hitting a local test MCP server.
   - Budget-cap mid-run rejection.
   - Cancellation between steps.
3. **Contract tests against real Claude Code / Goose skill files.** Take 5 published example skills from `~/.claude/skills/` and Goose's bundled set, run them through the Gatewaze parser, assert: (a) Tier-1 ones index successfully, (b) Tier-3 ones refuse with the correct `unsupported_features`.
4. **Goose recipe contract tests.** Take 3 example Goose recipes from the upstream `block/goose` repo (or `example-goose` fork), parse them, assert correct tier classification.
5. **Regression test for the existing AI usage dashboard.** Ensure `kind='recipe'` filtering doesn't break the existing cost breakdown.

## 12. Deployment Strategy

1. **Migrations 013, 014 ship together** in one PR. Migration 013 drops the existing `ai_skills` schema (zero-row precondition asserted in migration body via `SELECT COUNT(*) = 0` guard — fail-loud if the assumption is wrong in any deployment).
2. **Feature flag** `gatewaze.ai.recipes.enabled` (boolean, default false) gates the new admin tab and the `runRecipe()` endpoint. Skill discovery changes ship unconditionally (no flag needed — the parser is strict but the discovery rules don't break anything because no skills are in production).
3. **Operator config** `config/ai-recipes.yaml` ships empty (no stdio allowlist entries). Operators opt in to specific binaries by editing the file and restarting the API. Default is "all stdio extensions refused".
4. **Reversible.** Disabling the feature flag stops new runs but does not delete data. Downgrading the schema (rare) is via a separately-PR'd 015 that drops the new tables; existing `ai_skill_sources` rows are unaffected because they reference no removed columns.

## 13. Migration Plan

Since the existing `ai_skills` implementation is unused:

1. Migration 013 asserts zero rows, then drops the table and recreates it with the new schema.
2. Migration 014 creates `ai_recipe_sources`, `ai_recipes`, `ai_recipe_runs`, `ai_recipe_memory` and adds the `recipe_run_id` columns to `ai_usage_events`.
3. The Phase-2 work in migration 008 (`skill_source_id`, `skill_path` columns on `ai_use_cases`) is replaced by §6.3 — those columns are dropped in 013 and replaced by `recipe_source_id`/`recipe_file_path`, since recipes subsume skill-pinning as a more general primitive (a single-step recipe IS a single-call skill invocation, with the advantage of explicit parameter binding).
4. There is no in-place data migration. Operators rebuild their skill source rows after deploy — at zero rows, this is a no-op.

## 14. Open Questions / Future Considerations

1. **Should Tier-3 features be progressively un-blocked?** Sandboxed `inline_python` (Pyodide in a worker process) is the obvious next candidate; `developer`-equivalent (filesystem + shell) needs a per-run ephemeral container. Neither is in scope but both are well-defined v2 projects.
2. **Should we ship a Gatewaze-flavour skill registry alongside the cross-runtime one?** Skills that depend on Gatewaze-only data (`{{ gatewaze.thread_history }}`) would live in a separate `.gatewaze/skills/` directory walked by Gatewaze only and ignored by Claude Code / Goose. Cleaner separation than mixing portability tiers in one directory.
3. **MCP server registry as a first-class admin surface.** Currently the operator allowlist is a YAML config file. A `/admin/ai/mcp-servers` admin tab would make this discoverable and editable without restarts.
4. **Recipe parameter UI.** Today, recipes are kicked off via API POST. A "run recipe" form in the admin (auto-generated from `parameters:`) would let operators trigger ad-hoc runs without code. Probably worth shipping in the same PR as the recipe-runs tab.
5. **Cross-recipe state.** Today a recipe's `ai_recipe_memory` is scoped to the run. A "persistent memory" primitive that survives across runs of the same recipe (per-use-case or per-user) overlaps with `chatrecall` in Goose; deferred.