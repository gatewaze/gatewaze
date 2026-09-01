# Running Gatewaze on Kubernetes

This guide covers installing Gatewaze on a Kubernetes cluster with the bundled
Helm chart. It assumes you have already run Gatewaze locally with Docker
Compose and want to move it to a cluster. If you have not done that yet, start
with [Getting Started](./getting-started.md).

---

## Contents

- [What the chart does and does not install](#what-the-chart-does-and-does-not-install)
- [Prerequisites](#prerequisites)
- [Example values files](#example-values-files)
- [Step by step install](#step-by-step-install)
- [Resource sizing](#resource-sizing)
- [What each image does](#what-each-image-does)
- [Optional services](#optional-services)
- [Secrets](#secrets)
- [Upgrading](#upgrading)
- [Running more than one brand](#running-more-than-one-brand)
- [Troubleshooting](#troubleshooting)

---

## What the chart does and does not install

The chart installs the Gatewaze application: admin, portal, API, worker,
scheduler, and Redis. It also installs the optional services listed further
down, all of which are off by default.

The chart does not install Supabase. There are no Postgres, GoTrue, PostgREST,
Storage, or Edge Function templates in it. You bring your own database, and you
tell the chart where it is through the `supabase.*` values. The `supabase.mode`
value is a label for your own benefit. No template reads it, so setting it to
`self-hosted` does not cause anything to be deployed.

You have two realistic options for the database.

**Supabase Cloud.** You create a project at supabase.com and paste four values
into your values file. Supabase runs Postgres, authentication, storage, edge
functions, backups, point-in-time recovery, and connection pooling for you.
This is the recommended option, and it is what most of the sizing numbers below
assume.

**Your own Supabase.** You install Supabase yourself, either in the same
cluster with the
[community chart](https://github.com/supabase-community/supabase-kubernetes) or
on a machine next to it. Nothing leaves your network. You take on Postgres
upgrades, backups, restore testing, and connection pooling.

---

## Prerequisites

| Thing | Version | Why |
|---|---|---|
| Kubernetes cluster | 1.27 or later | The chart uses `autoscaling/v2` and `networking.k8s.io/v1`. |
| Helm | 3.x | To install the chart. |
| An ingress controller | any | The chart writes a standard `Ingress`. NGINX and Traefik both work. |
| cert-manager | any | Only if you want the chart to request TLS certificates for you. |
| A Supabase project or installation | Postgres 15 or later | See the section above. |
| The Supabase CLI | latest | To apply the Gatewaze database migrations before the first install. |

You also need three DNS names pointed at your ingress controller, one each for
the admin, the portal, and the API.

---

## Example values files

Three worked examples live in [`helm/examples/`](../helm/examples/). Copy the
one that matches your situation and edit it. Every value you have to change is
marked `CHANGE ME`.

| File | Use it when |
|---|---|
| [`values-minimal.yaml`](../helm/examples/values-minimal.yaml) | You want the shortest file that produces a running install, to prove the cluster works. |
| [`values-supabase-cloud.yaml`](../helm/examples/values-supabase-cloud.yaml) | You are running against Supabase Cloud. This is the recommended starting point. |
| [`values-self-hosted-supabase.yaml`](../helm/examples/values-self-hosted-supabase.yaml) | You are running your own Supabase, and you need the backup and connection pooling sections too. |

---

## Step by step install

### 1. Prepare the database

The chart does not create the Gatewaze schema. Apply the migrations to your
Supabase project before you install, from a checkout of this repository.

```bash
git clone https://github.com/gatewaze/gatewaze.git
cd gatewaze

export SUPABASE_ACCESS_TOKEN=<your supabase access token>
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Then deploy the edge functions. Gatewaze edge functions authenticate
internally, using the service role key, an HMAC signature, or an admin check,
and several of them serve anonymous public forms. Deploy them with
`--no-verify-jwt`, or Supabase will default them to rejecting every anonymous
caller and public forms will stop working.

```bash
npx supabase functions deploy --no-verify-jwt
```

### 2. Write your values file

```bash
cp helm/examples/values-supabase-cloud.yaml my-values.yaml
# edit my-values.yaml and replace every CHANGE ME
```

Three of these values must never change once you are live, because rotating
them breaks things that are already in the world.

- `publicApi.apiKeyPepper` hashes the API keys you issue. Rotating it
  invalidates every key.
- `email.unsubscribeHmacSecret` signs unsubscribe links. Rotating it breaks the
  unsubscribe link in every email you have already sent.
- `supabase.jwtSecret` must match the secret your Supabase project uses to sign
  the anon and service role keys.

Generate the first two with `openssl rand -base64 32` and
`openssl rand -base64 48`.

### 3. Install the chart

From the published chart repository:

```bash
helm repo add gatewaze https://gatewaze.github.io/gatewaze
helm repo update

helm install gatewaze gatewaze/gatewaze \
  --namespace gatewaze --create-namespace \
  -f my-values.yaml
```

Or from your checkout, which is useful while you are still changing values:

```bash
helm install gatewaze ./helm/gatewaze \
  --namespace gatewaze --create-namespace \
  -f my-values.yaml
```

Check what you are about to apply first with
`helm template gatewaze ./helm/gatewaze -f my-values.yaml`.

### 4. Watch it come up

```bash
kubectl -n gatewaze get pods -w
kubectl -n gatewaze get ingress
```

The portal pod runs `next build` when it starts, which takes a few minutes and
uses much more memory than it does afterwards. Do not be alarmed if the portal
is the last pod to become ready.

### 5. Run the first-time setup

Open the admin hostname in a browser. Gatewaze notices that no administrator
exists and shows you a setup wizard: name your platform, create your
administrator account, choose which modules to turn on, and pick a theme.

Email has to be working before you do this, because the wizard finishes by
emailing a sign-in link to the address you gave it. If email is not configured
the wizard warns you and signs you in directly instead, which is fine on a
laptop and not what you want on a cluster.

---

## Resource sizing

These are starting points. Watch your own pods for a week and adjust.

### With Supabase Cloud

The cluster runs only the application. This is the total of the chart's default
requests and limits.

| Component | Replicas | CPU requested | Memory requested | CPU limit | Memory limit |
|---|---|---|---|---|---|
| admin | 2 | 500m each | 1Gi each | 2 | 3Gi |
| portal | 2 | 500m each | 1Gi each | 2 | 3Gi |
| api | 2 | 100m each | 256Mi each | 500m | 512Mi |
| worker | 1 | 100m | 256Mi | 1 | 1Gi |
| scheduler | 1 | 50m | 128Mi | 200m | 256Mi |
| redis | 1 | 100m | 128Mi | 500m | 512Mi |
| **Total requested** | | **about 2.5 CPU** | **about 4.5 GB** | | |

A three node cluster of 4 vCPU and 8 GB nodes runs this comfortably with room
for rolling updates. A single 8 vCPU and 16 GB node also works if you do not
need the availability. For a small community you can drop every replica count
to 1, which brings the requests down to about 1.5 CPU and 3 GB, and fits on one
4 vCPU node. That is what `values-minimal.yaml` does.

Storage: 2Gi for the Redis volume, and 10Gi for the API volume if you leave
`api.persistence.enabled` on.

Supabase Cloud is billed separately. The free tier is enough to try Gatewaze.
A community of a few thousand people with regular email sending fits in the
Supabase Pro tier.

### With your own Supabase

Add the Supabase stack on top of everything above. The nine containers that
make up a self-hosted Supabase, measured on a working development install, use
roughly this much when idle.

| Container | Memory at rest |
|---|---|
| Kong, the API gateway | 1.3 GB |
| Realtime | 275 MB |
| Studio | 250 MB |
| PostgREST | 200 MB |
| Storage | 200 MB |
| Edge Function runtime | 175 MB |
| Postgres | 170 MB, and it grows with your working set |
| postgres-meta | 150 MB |
| GoTrue, authentication | 20 MB |
| **Total** | **about 2.7 GB idle** |

So budget roughly **2 more CPU and 4 more GB** for a small self-hosted Supabase
than for the Cloud option, before you account for Postgres growing into
whatever memory you give it. Add persistent storage for the database and for
uploaded files, plus the object storage your backups go to.

Two things people underestimate here. First, Postgres wants more memory than
the idle figure suggests as soon as it has real data in it, so give the
database its own node with headroom. Second, without Supavisor you have no
connection pooler, and two API replicas plus a worker will open more
connections than a default Postgres accepts. Turn on `database.poolingEnabled`
when you go past one API replica.

### Scaling up

The scheduler must stay at exactly one replica. It enqueues cron jobs, and a
second copy runs every job twice.

The API can run with two or more replicas. Its rate limiter is backed by Redis
rather than process memory, and migrations run in a Helm pre-upgrade Job under
a Postgres advisory lock, so nothing depends on there being only one of it.

The worker scales horizontally with the size of your job queue. Email sending
and image processing are the jobs that usually make people add workers.

Horizontal pod autoscaling is available for the API and the worker under
`autoscaling.components`. It is off by default.

---

## What each image does

The release pipeline publishes these to `ghcr.io/gatewaze`, tagged with both
the version and `latest`. The chart rejects the tag `latest` on purpose, so
that rolling back always lands on the image it landed on last time. Pin a
version.

| Image | What it is | Runs in the chart by default |
|---|---|---|
| `admin` | The administrator interface. A React application built with Vite and served by NGINX. This is where you manage people, events, content, email, and modules. | Yes |
| `portal` | The public website. A Next.js application rendered on the server. This is what your community sees. It builds itself when the pod starts, so its first minute is memory hungry. | Yes |
| `api` | The Express API server. It handles imports and exports, module installation and reconciliation, the public REST API at `/api/v1`, and the routes that modules register. It holds the Supabase service role key, so it can read and write past row level security. | Yes |
| `worker` | The background job runner, on Redis and BullMQ. It sends bulk email, processes images, runs scrapers, and executes any job a module registers. It carries a Chromium browser for the scrapers, so it is much larger than the other images and gets fixed on its own schedule. `worker.image.tag` lets you pin it separately. | Yes |
| `scheduler` | The cron process. It does no work itself. It puts jobs on the queue on a schedule, and the worker picks them up. Exactly one replica. | Yes |
| `se-runner` | A separate, leaner worker for the software-engineer module only. Node, git, and the Agent SDK, with no Chromium and no Goose. It consumes only that module's queue. Nothing consumes that queue unless you enable this, so those jobs simply stay queued. | No, `seRunner.enabled` |
| `scrapling-fetcher` | A Python fetching service built on Scrapling that the scrapers call instead of fetching pages themselves. It manages a browser pool, rate limits per domain, and can route traffic through one of eight residential proxy providers. | No, `scraplingFetcher.enabled` |
| `mcp-public` | A public, keyless Model Context Protocol endpoint with a read-only set of tools, so AI agents can read your events and content. It holds a read-scoped platform API key and rate limits per IP address. This is the only MCP service the chart exposes through the ingress. | No, `mcpPublic.enabled` |

Three more services have chart templates but no published image. Build and push
them yourself from `packages/` before you enable them.

| Image | What it is | Value |
|---|---|---|
| `events-mcp` | An internal MCP service for the `events_*` tools, including writing changes back to Luma. Service role backed, and deliberately not reachable from outside the cluster. | `eventsMcp.enabled` |
| `browser-mcp` | An internal MCP service that gives agents a headless browser, either Chromium in the pod or a hosted browser through Browserbase. Also not reachable from outside the cluster. | `browserMcp.enabled` |
| `custom-domain-controller` | Watches for custom domains added in the admin, and creates the Ingress and certificate resources for them. | `customDomains.enabled` |

The `arcade-serve` image, which serves creator-built games from storage
snapshots, has a chart template and no published image either. It needs
`arcadeServe.playOrigin`, `arcadeServe.portalOrigin`,
`arcadeServe.previewHmacSecret`, and `arcadeServe.ingress.host` set, and the
chart will refuse to render if you enable it without them.

Two images in the compose stack are third party and are not part of the chart.
Umami is a self-hosted analytics service, which the analytics module installs
through its own chart. Traefik is the reverse proxy used for local development,
where a Kubernetes install uses your ingress controller instead.

---

## Optional services

Everything in this table is off unless you turn it on.

| Value | What you get |
|---|---|
| `monitoring.enabled` | PodMonitor resources so the Prometheus Operator scrapes the worker on port 9090 and the scheduler on port 9091. The metrics endpoints work either way. This only registers them. Needs the Operator's custom resource definitions installed. |
| `monitoring.sentry.dsn` | Error reporting from the API, worker, and scheduler. Point it at a self-hosted GlitchTip if you would rather not send errors off site. |
| `monitoring.otel.endpoint` | OpenTelemetry traces over OTLP and HTTP, with automatic instrumentation for Express, Redis, Postgres, and Supabase. |
| `backup.enabled` | Daily full backups and write-ahead log shipping to S3-compatible storage with pgbackrest, plus a weekly Job that proves the backup restores. Leave it off on Supabase Cloud, which does this for you. |
| `database.poolingEnabled` | A PgBouncer deployment in front of Postgres. Leave it off on Supabase Cloud, which gives you Supavisor. |
| `migrations.preUpgradeJob.enabled` | A Helm pre-upgrade Job that applies migrations before new pods roll out, under a Postgres advisory lock. If it fails the rollout stops and the old pods keep serving. |
| `autoscaling.enabled` | Horizontal pod autoscalers for the API and the worker. |
| `customDomains.enabled` | The controller that turns custom domains added in the admin into Ingress and certificate resources. Needs an image you build yourself. |

---

## Secrets

The example values files contain secrets inline so that they are easy to read.
Do not commit them that way.

The straightforward approach is to keep the secrets in a separate file that
your version control ignores, and pass both files:

```bash
helm install gatewaze gatewaze/gatewaze \
  -n gatewaze --create-namespace \
  -f my-values.yaml \
  -f my-secrets.yaml
```

Teams that want the secrets in version control usually reach for
[SOPS](https://github.com/getsops/sops) with the
[helm-secrets](https://github.com/jkroepke/helm-secrets) plugin, or for the
[External Secrets Operator](https://external-secrets.io/) so that the values
come from a secret manager at deploy time. Either works with this chart. The
chart writes everything into one Kubernetes Secret named after the release.

Modules that need their own environment variables should ship their own
ConfigMap or Secret, which you then reference from `extraEnvFrom` rather than
editing this chart.

---

## Upgrading

```bash
helm repo update
helm upgrade gatewaze gatewaze/gatewaze \
  -n gatewaze \
  -f my-values.yaml \
  --set image.tag=<new version>
```

Deployments roll rather than restart, and the pod disruption budget keeps at
least one pod of each service ready while they do.

Two things do not travel with the chart. Database migrations are applied by the
pre-upgrade Job only if you turned it on, and otherwise you run
`npx supabase db push` yourself before the upgrade. Edge functions are never
deployed by CI or by Helm, so run
`npx supabase functions deploy --no-verify-jwt` after changing any of them.

To go back:

```bash
helm rollback gatewaze -n gatewaze
```

Rollback returns the pods to the previous image. It does not undo a database
migration, which is why the migration Job runs before the rollout rather than
after it.

---

## Running more than one brand

Each brand is a separate Helm release in its own namespace, with its own values
file, its own Supabase project, and its own Redis.

```bash
helm install brand-a gatewaze/gatewaze -n brand-a --create-namespace -f brand-a.yaml
helm install brand-b gatewaze/gatewaze -n brand-b --create-namespace -f brand-b.yaml
```

Nothing is shared between them, so there is no way for one brand's data to
reach another. The cost is that you pay for the whole stack twice.

---

## Troubleshooting

**Finish the setup wizard promptly.** The first-time setup runs through two
Supabase edge functions, `platform-setup` and `admin-add-first`, which have to
be callable before any account exists and so run without authentication. Both
refuse to run once an administrator exists, so completing the wizard is what
closes that window. Deploy the edge functions and finish the wizard before you
hand the hostnames out.

**Pods will not start with `ImagePullBackOff`.** Check that you pinned
`image.tag` to a version that exists in
[the releases](https://github.com/gatewaze/gatewaze/releases). If it is one of
`events-mcp`, `browser-mcp`, `arcade-serve`, or `custom-domain-controller`,
that image is not published and you have to build it yourself.

**Helm refuses to render, saying `image.tag=latest is forbidden`.** That is
deliberate. Pin a version or a git commit, so that a rollback is repeatable.

**Helm refuses to render, saying `redis.password must be set`.** Also
deliberate. Earlier versions of the chart shipped a known default password.
Set one with `openssl rand -base64 32`.

**The portal pod is killed while starting.** It runs `next build` at startup
and needs the memory. Raise `resources.portal.limits.memory` rather than
lowering it.

**The API cannot reach the database.** On Supabase Cloud, use the session-mode
pooler connection string from the dashboard rather than the direct connection.
The direct connection does not accept as many clients.

**Modules do not appear in the admin.** The API and worker clone the module
sources when they start. Check `moduleSources`, then look at the API pod logs
for clone failures. A private repository needs credentials the pod does not
have by default.

**Background jobs never run.** Check that the worker pod is running and that
`REDIS_URL` resolves. Jobs for the software-engineer module stay queued forever
unless `seRunner.enabled` is on, because the standard worker deliberately does
not consume that queue.
