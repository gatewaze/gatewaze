# Integration tests (real Supabase)

These tests run against a live Supabase instance started by `supabase
start`. They replace the mock-Supabase route tests from earlier
phases — those only verified Supabase JS chain plumbing, not actual
RLS / query behaviour.

## Run locally

```bash
# 1. Start Supabase
supabase start

# 2. Apply migrations
supabase db reset

# 3. Run integration tests
SUPABASE_INTEGRATION=1 \
SUPABASE_URL=http://localhost:54321 \
SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env --override-name=SUPABASE_SERVICE_ROLE_KEY | cut -d= -f2-) \
SUPABASE_ANON_KEY=$(supabase status -o env --override-name=SUPABASE_ANON_KEY | cut -d= -f2-) \
SUPABASE_JWT_SECRET=$(supabase status -o env --override-name=SUPABASE_JWT_SECRET | cut -d= -f2-) \
pnpm --filter @gatewaze/api exec vitest run test/integration
```

## CI

The PR workflow (`.github/workflows/pr.yml`) starts Supabase in a
sidecar and runs the same command. Tests are skipped when
`SUPABASE_INTEGRATION` is unset (the default for local unit-test
runs), so adding a file here doesn't break `pnpm test`.

## Coverage targets (Session 16 → Session 18)

- [x] Tenancy v2 — multi-account isolation under flag-on
- [ ] Auth — requireJwt() against a real Supabase JWT
- [ ] RSVP — invite token → registration → capacity-exceeded path
- [ ] Invites — sub-event conditional logic
- [ ] Module install — reconcile flow end-to-end

Session 16 lands the harness + tenancy test; the rest follow in
Session 17 / 18 as the routes get migrated to `getRequestSupabase`.
