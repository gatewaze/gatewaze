---
name: Security patterns
description: How this project handles auth, secrets, input validation, and file operations
type: project
---

- SUPABASE_ACCESS_TOKEN is read from env at constructor time in CloudApiStrategy; never logged in the happy path
- SUPABASE_SERVICE_ROLE_KEY is used as Bearer token for edge function invocation in the invoke-function proxy; it is never returned to clients
- Module sources API correctly strips `token` field from GET responses (GET /sources sets token: undefined, hasToken: bool)
- Path traversal for zip uploads uses TOCTOU order: extract first, then check — known pattern in this codebase
- resolveSharedImports uses regex `[\w.-]+\.ts` which excludes `/` so standard `../` traversal is blocked; dots-only filenames are safe with path.join
- verify_jwt: false is intentional for module edge functions (modules do their own auth via Supabase RLS)
- EDGE_FUNCTIONS_CONTAINER env var is used unsanitized in Docker socket path construction (local dev only)
- invoke-function proxy endpoint has no authentication gate — relies on network-level access control (API server is not public-facing in intended deployment)
