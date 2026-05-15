# Portal → Cloudflare Workers cutover runbook

Operational runbook for migrating an AAIF-style brand's Portal from a
K8s pod to a Cloudflare Worker via OpenNext. Implements
`spec-portal-on-cloudflare-workers.md` §13.

This runbook is **brand-scoped**. Repeat the whole sequence per brand
(AAIF first; AutoDB and any white-label brands follow once AAIF has
been stable for 30 days).

## Prerequisites checklist

- [ ] **Cloudflare account** has the target zone (e.g. `aaif.live`) and
      Workers Paid plan ($5/mo).
- [ ] **GitHub repo secrets** present:
      - `CF_API_TOKEN` — scoped to Workers Scripts:Edit, Workers KV:Edit,
        Workers R2:Edit, Zone:Workers Routes:Edit on the target zone.
      - `CF_ACCOUNT_ID`
      - `GH_PAT_MODULES` — already exists (same secret as release.yml
        uses for the admin prebuild).
      - `PORTAL_SUPABASE_ANON_KEY` — anon key for the brand.
      - `PORTAL_SUPABASE_JWT_SECRET` — optional; only needed if the
        Worker verifies JWTs locally.
- [ ] **Spec 1 (PartyKit chat)** has been shipped on the K8s portal and
      run for at least one full virtual event. Spec authors strongly
      recommend NOT changing two things at once (per spec §14).
- [ ] **cdn.aaif.live** Worker is live and caching public reads (per
      `spec-api-cache-and-revalidation.md`). Verify with:
      ```bash
      curl -sI https://cdn.aaif.live/api/portal/events \
        | grep -i cache-status
      ```
      Expect `cf-cache-status: HIT` after the first warm.

## Phase 2 — infrastructure provisioning

Run from the repo root with `wrangler` installed (`pnpm --filter @gatewaze/portal exec wrangler --version`):

```bash
cd packages/portal

# Authenticate (one-time). The token from CF_API_TOKEN works:
export CLOUDFLARE_API_TOKEN=<paste>
export CLOUDFLARE_ACCOUNT_ID=<paste>

# Create the R2 bucket for static assets. Same name as in wrangler.toml.
wrangler r2 bucket create gatewaze-portal-aaif-assets
wrangler r2 bucket create gatewaze-portal-aaif-staging-assets

# Create the four KV namespaces (prod + staging × CACHE + SLUG_CACHE).
wrangler kv namespace create CACHE
wrangler kv namespace create SLUG_CACHE
wrangler kv namespace create CACHE --env staging
wrangler kv namespace create SLUG_CACHE --env staging
```

Each `wrangler kv namespace create` prints an `id = "abc123..."` line.
**Paste each into `packages/portal/wrangler.toml`** replacing the four
`TODO_*_NAMESPACE_ID` placeholders. Commit on a feature branch and PR.

### Phase 2 — set Worker secrets

Secrets aren't checked in. Set them once per environment:

```bash
echo "$PORTAL_SUPABASE_ANON_KEY" | wrangler secret put SUPABASE_ANON_KEY
echo "$PORTAL_SUPABASE_ANON_KEY" | wrangler secret put SUPABASE_ANON_KEY --env staging
# Only if needed:
echo "$PORTAL_SUPABASE_JWT_SECRET" | wrangler secret put SUPABASE_JWT_SECRET
```

The GitHub Actions workflow (`.github/workflows/portal-deploy.yml`)
re-pushes these on each deploy, so a one-off manual `secret put` is
only required for the first staging build.

## Phase 3 — staging soak (≥1 week)

Once Phase 2 is complete, ship to staging:

```bash
# From GitHub Actions UI: run "Portal Deploy" workflow with
# environment=staging. Or locally:
cd packages/portal
OPENNEXT_BUILD=1 pnpm run build
pnpm run opennext:build
pnpm exec opennextjs-cloudflare deploy --env staging
```

Smoke checks:

```bash
# Resolves to a Cloudflare IP (not the Linode LB IP)?
dig +short staging.aaif.live | head -1

# 200 OK from the Worker?
curl -sI https://staging.aaif.live/ | head -1

# Edge cache warms on the second request?
curl -sI https://staging.aaif.live/events/upcoming -o /dev/null -w "%{http_code}\n"
curl -sI https://staging.aaif.live/events/upcoming | grep -i cf-cache-status
# Expect: cf-cache-status: HIT
```

### Phase 3 — middleware parity matrix

Both halves of the matrix must pass before cutover:

```bash
# Unit-level (vitest, runs against the middleware module directly).
pnpm --filter @gatewaze/portal exec vitest run __tests__/middleware-parity.test.ts

# Integration-level (against the staging Worker). Set the host header
# so the Worker thinks it's serving the production domain.
for host in aaif.live my-conference.example.com; do
  echo "=== ${host} ==="
  curl -sI -H "Host: ${host}" https://staging.aaif.live/api/health | head -1
  curl -sI -H "Host: ${host}" https://staging.aaif.live/events | head -1
done
```

Document the output for posterity in the cutover PR description.

### Phase 3 — load test

10K virtual users for 10 minutes hitting the staging Worker. Pass
criteria are baked into the k6 script (`tests/load/portal-cutover.k6.ts`):

```bash
EVENT_SLUG=<a-real-staging-event-slug> \
BASE_URL=https://staging.aaif.live \
  k6 run --vus 10000 --duration 10m tests/load/portal-cutover.k6.ts
```

Pass criteria (also enforced as `thresholds` in the k6 script):
- p99 cached < 200ms
- p99 SSR < 600ms
- 5xx rate < 0.5%
- All-cause failure < 1%

If thresholds fail: investigate via Cloudflare Workers Analytics +
Logpush before scheduling cutover.

## Phase 4 — production cutover

Schedule for a low-traffic window. DNS propagation is cheap (60s
TTL) but the rollback path is faster the longer K8s portal is
still serving.

### Pre-cutover (T - 30 min)

```bash
# 1. Make sure the staging Worker is running the same build as you're
# about to promote.
gh workflow list --workflow=portal-deploy.yml | head -3
git tag portal-v1.0.0 # or whatever the next version is
git push origin portal-v1.0.0
# Workflow will deploy to production Worker on the tag push.

# 2. Pre-warm the production KV cache by hitting common URLs from a
# deploy host. The Worker's cold-isolate path will populate KV on the
# first hit; this avoids the first 1000 real viewers paying that cost.
for path in / /events /events/upcoming /events/past; do
  curl -s -H "Host: aaif.live" "https://staging.aaif.live${path}" -o /dev/null -w "%{http_code} ${path}\n"
done

# 3. Verify the production Worker responds on its own URL (before DNS swap):
curl -sI -H "Host: aaif.live" "https://gatewaze-portal-aaif.<your-account>.workers.dev/" | head -1
```

### Cutover (T = 0)

```bash
# DNS swap. Replace the K8s LB IP with the Cloudflare Worker route.
# In the AAIF Cloudflare zone:
#   aaif.live (A or CNAME) → previously Linode LB IP
#                          → after swap: served by the Worker route
# This is done via the Cloudflare dashboard OR:

wrangler deploy  # production, picks up `[[routes]]` in wrangler.toml

# At this point, requests to aaif.live land on the Worker.
# Verify:
curl -sI https://aaif.live/ | head -1
curl -sI https://aaif.live/events | head -1

# If those 200, monitor for ≥1 hour before declaring success.
```

### Post-cutover monitoring (T + 1h)

- Cloudflare Workers Analytics dashboard:
  - Request rate baseline normal?
  - Error rate <0.5%?
  - p99 latency in target?
- Sentry: no new error spike?
- Support: no incoming "site is broken" tickets?

If anything red: rollback (next section).

If green for 24h, mark cutover complete. Don't scale K8s portal to 0
yet — keep it running as warm spare for ≥7 days.

## Phase 4 — rollback runbook

Two windows. The boundary is whether the K8s portal pod has been
scaled to 0.

### < 7 days post-cutover (K8s portal still warm)

Total time: ~5 minutes.

```bash
# Revert DNS / Worker route. From the Cloudflare dashboard:
#   Disable the [[routes]] entry on the Worker, OR
#   Change the A/CNAME record back to the Linode LB IP.

# Verify Linode is serving again:
curl -sI https://aaif.live/ | head -1
# Expect a Next.js standalone server header, not Cloudflare's.
```

The K8s pod has been running the whole time so its session caches,
warm pages, etc. are fine.

### ≥ 7 days post-cutover (K8s portal scaled to 0)

Total time: ~15 minutes (most of it Vite-build-at-startup).

```bash
# 1. Scale the K8s portal deployment back up. In gatewaze-environments:
cd /Users/dan/Git/gatewaze/gatewaze-environments
yq e '.replicaCount.portal = 1' -i values-aaif.yaml
git add values-aaif.yaml && git commit -m "ops(aaif): rollback portal to k8s"

# 2. Apply via helm upgrade or your usual deploy path:
helm upgrade aaif ./charts/gatewaze -f values-aaif.yaml --namespace aaif

# 3. Wait for the new portal pod to become ready (the admin pod's
# entrypoint takes 3-5 min for the Vite build at startup; portal is
# similar). Watch with:
kubectl -n aaif get pods -w -l app=portal

# 4. Once the pod is Ready, revert DNS (same as the <7d path).

# 5. Verify and then disable the Worker route so future requests
# don't accidentally re-route:
wrangler deploy --dry-run  # confirms current production config
# Disable via dashboard, OR remove [[routes]] from wrangler.toml and
# re-deploy.
```

## Long-term — K8s deprovisioning

After 7 consecutive days of clean operation on Cloudflare:

```bash
cd /Users/dan/Git/gatewaze/gatewaze-environments
yq e '.replicaCount.portal = 0' -i values-aaif.yaml
git commit -am "ops(aaif): scale k8s portal to 0 (cutover complete)"
helm upgrade aaif ./charts/gatewaze -f values-aaif.yaml --namespace aaif
```

Keep the deployment definition in values-aaif.yaml indefinitely. Re-
provisioning a portal pod from `replicaCount: 0` is a one-line YAML
change; deleting the deployment definition would mean rewriting it
in a panic.

## Brand rollout cadence

Per spec §13:
- **AAIF**: first cutover. Soak ≥30 days before next brand.
- **AutoDB**: follows AAIF, same playbook. Different zone + R2 bucket
  + KV namespaces + secrets.
- **White-label brands** with custom domains: handled via Cloudflare
  for SaaS or additional `[[routes]]` blocks in the existing
  Worker's wrangler.toml.
