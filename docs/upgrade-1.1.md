# Upgrading to Gatewaze 1.1.0 (`hardening-p1`)

This release implements **phase 1** of
[spec-production-readiness-hardening](../../gatewaze-environments/specs/spec-production-readiness-hardening.md).
Runtime behaviour is unchanged for users with `tenancy_v2_enforced=false`
(the default). Operators must run a pre-flight + backfill before
flipping the flag in production.

## Breaking changes

### 1. Redis password default removed

The Helm chart no longer ships with `redis.password=gatewaze`. The
template now fails the deploy if `redis.password` is empty. Operators
must set a strong random password in their `values-*.yaml`:

```yaml
redis:
  password: <32+ random characters>
```

Operators upgrading from earlier charts are **strongly encouraged to
rotate** the password (the prior default was a publicly known string).

### 2. `VERIFY_JWT` defaults to true

`docker-compose.yml` previously defaulted `VERIFY_JWT=false`. Edge
functions now default to **true** — they reject unverified tokens out
of the box. Set `VERIFY_JWT=false` in `.env` only for local dev
explicitly testing the bypass.

### 3. Admin module routes are JWT-gated

`/api/modules/*`, `/api/screenshots/*`, `/api/db-copy/*` and 12 other
admin routers now require a valid Supabase JWT. Any tooling or scripts
hitting these routes without an `Authorization: Bearer …` header will
return `401 unauthenticated`. Use a service account JWT (admin profile
required) or wait for service-token rotation in phase 3.

### 4. Module sources reject invalid branch names

`POST /api/modules/sources` rejects `branch` values that don't match
`^[\w][\w.\-/]{0,254}$`. Existing rows are not migrated automatically
— run `pnpm exec tsx scripts/quarantine-module-sources.ts --commit`
to disable any pre-existing rows that wouldn't pass the new check.

### 5. Dependency upgrades

- `swiper` 11.2.10 → 12.1.x (critical: prototype pollution in
  GHSA-hmx5-qpq5-p643).
- `next` 15.1.x → 15.5.15 (DoS in GHSA-q4gf-8mx6-v5v3).
- `vite` 7.1.x → 7.3.2 (file read in GHSA-p9ff-h696-f583).

## Pre-flight + flag flip (operator-driven)

The tenancy_v2 flag flip is **not automatic**. After deploying 1.1.0
to production, operators must:

```bash
# 1. Apply migrations 00024 / 00025 / 00026 + module migrations
pnpm exec tsx scripts/preflight-check.ts
# Should report "All checks passed".

# 2. Backfill account_id on tenant tables (dry-run first)
pnpm exec tsx scripts/backfill-tenancy.ts                # dry-run
pnpm exec tsx scripts/backfill-tenancy.ts --commit       # apply

# 3. Re-run preflight to confirm zero NULL-account rows
pnpm exec tsx scripts/preflight-check.ts

# 4. Soak in staging for ≥ 48 h with the flag still false.

# 5. Flip the flag.
psql "$DATABASE_URL" -c \
  "UPDATE platform_settings SET value='true' WHERE key='tenancy_v2_enforced';"
```

The flag is **global**, not per-account. To revert, set the value
back to `'false'` — RLS policies fall back to the v1 path
immediately (no migration needed).

## What ships in 1.1.0

| Spec ref | Status | Notes |
|---|---|---|
| PR-C-1 cross-tenant data leakage | Closed (foundations) | dual-track v1/v2 RLS on people, email_logs, events, registrations, attendance, event_invites, events_communication_settings; `tenancy_v2_enforced` flag default false |
| PR-C-2 unauth admin module routes | Closed | `requireJwt()` on every static admin router; startup self-check |
| PR-C-3 RCE via branch interpolation | Closed | branch validation + `safeExec()` wrapper + grep-audit script |
| PR-H-1 vulnerable deps | Closed | swiper / next / vite upgraded |
| PR-H-2 stored XSS | Closed | DOMPurify on email preview + 4 portal legal pages |
| PR-H-3 VERIFY_JWT default | Closed | docker-compose.yml flipped to true |
| PR-H-5 default Redis password | Closed | empty default + Helm fail-fast |
| PR-H-7 silent-deny tables | Closed | explicit deny-all + service-role bypass on integration_events, api_keys, public_api_idempotency_keys |
| PR-H-9 zip TOCTOU | Closed (side effect of Session 2) | adm-zip manifest scan before extraction |
| PR-H-13 broken pgTAP | Closed | rls_people.test.sql repaired |

What ships **later**: error tracking (phase 2), backups + image-tag
pinning (phase 3), real-Supabase integration tests + frontend
optimisations (phase 4). See
[spec-production-readiness-hardening §7](../../gatewaze-environments/specs/spec-production-readiness-hardening.md#7-workstreams-and-milestones).

## Rollback

If the flag flip causes regressions:

```sql
UPDATE platform_settings SET value='false' WHERE key='tenancy_v2_enforced';
```

Every v2 RLS policy disables itself immediately; v1 policies take
over without a migration. The `account_id` columns and helper
functions stay in place — no DDL rollback needed.

If a release-level rollback is required (revert to 1.0.x), the
`account_id` columns and the `set_app_account_id` RPC are forward-
compatible — they are unused in 1.0.x. Migrations 00024–00026 do
not need to be reversed.
