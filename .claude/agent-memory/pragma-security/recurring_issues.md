---
name: Recurring issues
description: Modules that repeatedly surface security findings
type: project
---

- packages/api/src/routes/modules.ts — invoke-function proxy lacks auth gate; function name has no allowlist (first flagged 2026-03-31)
- packages/shared/src/modules/deploy-strategies/cloud-api.ts — syncSecrets error log may echo Supabase API response body containing secret values (first flagged 2026-03-31)
- packages/api/src/routes/modules.ts (upload) — TOCTOU in zip path-traversal check: extract before verify (first noted 2026-03-31; existing pattern, not new in this diff)
