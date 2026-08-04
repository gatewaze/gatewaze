# @gatewaze/arcade-serve

Arcade Serve is the games origin: the single application behind `PLAY_ORIGIN`
(`play.<domain>`, for example `https://play.aaif.dev`). It serves creator-built
SPA games out of immutable, versioned storage snapshots, with the header
contract from §6 of `spec-arcade-module.md` applied to every response.

It also ships the browser SDK that games use (`sdk/gatewaze-arcade.js`), which
is both served at `/sdk/gatewaze-arcade-1.js` and meant to be vendored into
creator repos. See `sdk/README.md` for the integration guide.

This package is deliberately outside the pnpm workspace graph (same as
`packages/browser-mcp` and `packages/events-mcp`). It has one runtime
dependency, builds with plain `npm` inside its own Dockerfile, and can be
deployed, rolled back or scaled to zero without touching the platform.

## Why `node:http` and not express

Matching `browser-mcp`. The route surface is fixed and tiny — six shapes, all
`GET`/`HEAD` — so a router buys nothing, and every dependency on a public origin
that serves third-party code is a supply-chain liability worth avoiding. The
runtime image installs exactly one production package (`@supabase/supabase-js`),
which keeps the attack surface and the image small. If the route set ever grows
past what `matchRoute()` can express clearly, revisit the decision then.

## Routes

| Route | Behaviour |
|---|---|
| `GET /g/:slug/` | 302 to `/g/:slug/v/<liveVersionId>/`, `Cache-Control: public, max-age=5`. The canonical embed and share URL — publish and rollback take effect within seconds with no portal re-render. Published games only. |
| `GET /g/:slug/v/:versionId/` | That version's manifest `entry` file. `Cache-Control: public, max-age=31536000, immutable`. |
| `GET /g/:slug/v/:versionId/<assetPath>` | The manifest-matched asset, same immutable caching. Creator-relative URLs like `./questions.js` resolve here unchanged. |
| `GET /sdk/gatewaze-arcade-1.js` | The browser SDK. `Cache-Control: public, max-age=3600`, `Content-Type: application/javascript; charset=utf-8`. |
| `GET /healthz` | Liveness. **Cluster-internal only.** |
| `GET /readyz` | Readiness, including a database reachability probe. **Cluster-internal only.** |
| `GET /metrics` | Prometheus text format, `arcade_serve_*`. **Cluster-internal only.** |

`/g/:slug` and `/g/:slug/v/:versionId` (no trailing slash) 302 to the
trailing-slash form so relative asset URLs resolve against the game directory.

Anything else is a 404. Non-`GET`/`HEAD` methods are a 405.

The three operational endpoints are kept off the public host by the Ingress in
`helm/gatewaze/templates/arcade-serve.yaml`, which routes only `/g` and `/sdk`.
Do not add a `/` catch-all rule to it.

## How a request is served

Path → DB lookup → manifest gate → storage read. A URL path is **never** mapped
onto a storage key.

1. `matchRoute()` recognises the shape and validates the slug
   (`^[a-z][a-z0-9-]{1,60}$`) and the version id (uuid).
2. The catalog resolves slug → game → version from `arcade_games` and
   `arcade_game_versions`. `game_id` is part of the version predicate, so a
   version belonging to another game can never be served under this slug.
3. Access policy: a `published` game serves openly. A `draft` or `archived` game
   requires a valid `?p=` preview token (below). Every failure is a 404, never a
   403 — the origin must not confirm that an unpublished version exists.
4. `normaliseAssetPath()` decodes each path segment exactly once and rejects
   anything that is not a plain relative path: `..` (raw, encoded and
   double-encoded), absolute paths, backslashes, `%2f`/`%5c`/`%00`, control
   characters, empty segments and Windows drive prefixes. Nothing is
   "cleaned up" — bad input is refused.
5. The normalised path must appear in `manifest.files[].path`. An object that
   exists in storage but is not in the manifest is a 404, and no storage call is
   made at all.
6. `Content-Type` comes from that file's recorded `content_type`, validated
   against a fixed allowlist. It is never sniffed from bytes and never derived
   from the request. An unknown or missing type is a 404.
7. Only then is the storage key built, as `storage_prefix + normalisedPath`, and
   the object streamed to the client.

Slug and version lookups are cached in memory for 5 seconds. That TTL is what
bounds publish and rollback propagation on this service; combined with the
5 second redirect cache, total propagation is bounded at about 10 seconds.
Misses are cached too, so an unknown slug does not become a query per request.

## Preview tokens

Draft and archived versions are reachable only with a signed `?p=` parameter,
minted server-side by the module API (`POST …/admin/versions/:versionId/preview-link`).

```
payload = "v=1&vid=<version_uuid>&exp=<unix_seconds>"      exact ASCII bytes
token   = base64url(payload) "." base64url(HMAC-SHA256(payload, secret))
```

The signature is verified over the decoded payload bytes exactly as signed; the
payload is parsed only after the signature checks out and is never re-serialised
for comparison. base64url is unpadded and must round-trip, so padded or
`+`/`/`-alphabet variants are rejected. Comparison is constant time, `vid` must
equal the version id in the path, and `exp` must be at or after now.
`ARCADE_PREVIEW_HMAC_SECRET_PREVIOUS` is accepted alongside the current secret
so the secret can rotate with a dual-secret window.

## Response headers

Every response, including 404s and the error pages:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' <PORTAL_ORIGIN>; frame-src 'none'; frame-ancestors <PORTAL_ORIGIN>; base-uri 'none'; form-action 'none'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

`Cross-Origin-Embedder-Policy` and `Cross-Origin-Resource-Policy` are
intentionally absent (§6). **No cookie is ever set on this origin.**

A game row's `csp_exceptions` may extend `connect-src`, `img-src`, `media-src`
and `font-src` only, and only with exact `https://host[:port]` origins. The
admin API validates on write and this service validates again at serve time:
anything outside the allowlist — another directive, an `http:` or `data:` value,
a wildcard, an origin carrying a path — is dropped silently. `script-src`,
`style-src`, `default-src`, `frame-*`, `object-src`, `base-uri` and `form-action`
can never be extended.

Unknown slug, version or asset returns 404 with `Cache-Control: no-store` and a
minimal self-contained error page ("Game not found"); an internal failure
returns 500 with "Temporarily unavailable". Both carry the full header set, so
an iframe failure still shows something sane.

## Read-only database posture

This service has **no insert, update, delete, upsert, rpc, upload or remove path
anywhere in its source**. Every database call is `.select()` and the only storage
call is `.download()`. That is not a convention — `src/__tests__/read-only.test.ts`
scans the whole `src/` tree and fails the build if a write path appears, and it
also asserts that `ARCADE_TOKEN_SECRET` never appears here and that nothing sets
a cookie.

Deploy it with a dedicated Postgres role holding `SELECT` on `arcade_games` and
`arcade_game_versions` where the platform allows one (`ARCADE_SUPABASE_KEY`).
Where it does not yet, the service-role key is the documented fallback and the
three compensating controls from §13 apply: this static check, a network policy
limiting egress to the database and storage, and brand-scoped secrets.

`ARCADE_TOKEN_SECRET` belongs to the module API and must never appear in this
service's environment.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `8080` | Listen port. |
| `ARCADE_PLAY_ORIGIN` | **yes** | — | This origin, e.g. `https://play.aaif.dev`. Explicit config, never inferred from `Host`. Used for logging and for the optional strict-host check. |
| `ARCADE_PORTAL_ORIGIN` | **yes** | — | The portal origin, e.g. `https://aaif.dev`. Goes into `connect-src` and `frame-ancestors`. |
| `ARCADE_PREVIEW_HMAC_SECRET` | **yes** | — | Validates admin preview links. Dedicated secret; **not** `ARCADE_TOKEN_SECRET`. |
| `ARCADE_PREVIEW_HMAC_SECRET_PREVIOUS` | no | — | Previous secret, accepted during a rotation window. |
| `ARCADE_STORAGE_BUCKET` | no | `arcade` | Private storage bucket holding the snapshots. |
| `SUPABASE_URL` | **yes** | — | Database and storage endpoint. |
| `ARCADE_SUPABASE_KEY` | **yes** (or fallback) | — | Read-only credential. Falls back to `SUPABASE_SERVICE_ROLE_KEY` if unset; prefer the dedicated one. |
| `ARCADE_CACHE_TTL_MS` | no | `5000` | Lookup cache TTL. Hard-capped at 5000 ms. |
| `ARCADE_STRICT_HOST` | no | `false` | When `1`/`true`, `/g/*` requests whose `Host` does not match `ARCADE_PLAY_ORIGIN` return 404. |

Startup fails with a clear message on any missing or malformed required value —
a misconfigured origin must kill the container rather than serve a weaker policy.

## Deployment

- **Image:** `packages/arcade-serve/Dockerfile`, single stage on `node:22-slim`,
  `HEALTHCHECK` on `/healthz`, runs as the `node` user.
- **Local:** the `arcade-serve` service in `docker/docker-compose.yml`, published
  on `ARCADE_SERVE_PORT` (default 8090) and off traefik.
- **Kubernetes:** `helm/gatewaze/templates/arcade-serve.yaml`. Add an
  `arcadeServe` block to `values-{brand}.yaml`:

```yaml
arcadeServe:
  enabled: true
  replicaCount: 2
  image:
    repository: ghcr.io/gatewaze/arcade-serve
    tag: ""            # defaults to Chart.AppVersion; pin to a git SHA in prod
  playOrigin: https://play.aaif.dev
  portalOrigin: https://aaif.dev
  storageBucket: arcade
  strictHost: true
  supabaseKey: ""      # SELECT-only credential; falls back to the release service-role key
  previewHmacSecret: ""
  previewHmacSecretPrevious: ""
  ingress:
    enabled: true
    host: play.aaif.dev
    tls:
      enabled: true
      secretName: play-aaif-dev-tls
```

Rollback is scale-to-zero or removing the ingress: the portal keeps working, the
iframe shows the error page, and no data is affected.

## Development

```bash
npm install          # this package has its own lockfile-free npm install
npm run dev          # tsx src/index.ts
npm test             # vitest
npm run build        # tsc → dist/
```

The test suite covers path normalisation against every traversal variant,
manifest gating (an object present in storage but absent from the manifest 404s
without a storage call), the preview-token accept/reject matrix including
rotation and padding variants, the exact header set on both a served game and a
404, the live-route 302 and its 5 second cache, content-type sourcing, and the
SDK's local-mode fallback and portal-mode behaviour.
