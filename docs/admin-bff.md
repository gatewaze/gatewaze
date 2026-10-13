# Admin BFF (host-session mode)

The admin BFF is a small server in `packages/admin-bff`. It holds the admin's Supabase session on the server, so the browser never has an access token or a refresh token. It is off by default. The admin keeps its usual in-browser Supabase session unless you turn this on.

The design comes from Eric Searcy's proof of concept for embedding the Gatewaze admin in LFX One (September 2026). The code keeps his structure and names. The places where it differs are listed at the end of this page.

## What it does

When the admin runs with `VITE_AUTH_MODE=host-session`, the admin page sends all of its Supabase and API calls to its own origin. The ingress sends these paths on the admin host to the BFF:

| Path | Where the BFF sends it |
|---|---|
| `/bff/*` | Handled by the BFF itself (sign-in, sign-out, current user, health) |
| `/rest/v1/*` | Supabase PostgREST |
| `/storage/v1/*` | Supabase Storage |
| `/functions/v1/*` | Supabase edge functions |
| `/realtime/v1/*` | Supabase Realtime, as a WebSocket |
| `/api/*` | The Gatewaze API, with the path kept |

Every other path on the admin host, including `/embed/` and `/healthz`, stays on the admin nginx container.

For each proxied request the BFF does the following.

- It reads the session cookie. The cookie is encrypted and holds only a random session ID.
- It loads the session from Redis. If the access token expires within 60 seconds, it refreshes the session first.
- It removes the browser's `Authorization` header, cookies, `Origin` and `Referer`. It also removes `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`, `Forwarded`, and any header that the request's `Connection` header names.
- It adds `Authorization: Bearer <the real access token>`. On Supabase paths it also adds `apikey: <anon key>`.
- It removes `access_token` from the query string, and `token` when its value is the `host-session` placeholder. The token travels only in the header, so it never appears in an upstream access log.
- It appends the client address to `X-Forwarded-For`.
- It streams the request and response bodies without buffering them. If the browser goes away first, it aborts the upstream request.
- It drops any `Set-Cookie` and any `x-gw-session` header from the upstream, so only the BFF can set the session marker. The BFF checks every upstream `Location` header as follows.

- A redirect to the upstream's own internal address, or to the admin's public origin, is made relative.
- A relative redirect must stay on the same origin. A path that starts with `//`, including one that only becomes `//` after `..` is resolved, is removed.
- A redirect to any other `https:` address passes through unchanged. Edge functions choose their own redirect targets, e.g. the Google Sheets sign-in sends the browser to `accounts.google.com`, the same as when the browser calls them directly.
- `http:` passes only to `localhost`, `127.0.0.1` and `*.localhost`, for local development.
- Everything else is removed, and the BFF logs it. That covers other schemes such as `javascript:` and `data:`, and any value with a backslash or a control character, because browsers read those as another host.
- When the request used the session, it marks the response `Cache-Control: private` (keeping the upstream's other directives) and adds `Cookie` to `Vary`, so no shared cache can serve it to someone else.

For Realtime, the BFF accepts the browser's WebSocket and opens its own socket to Realtime. It writes the real token into every `phx_join` and `access_token` message, because Realtime reads the token from those messages and not from a header. Before the token expires, the BFF refreshes the session and sends Realtime the new token. When the user signs out, on any replica, the BFF closes that user's sockets with code 4001.

The bridge relays only Phoenix JSON text messages from the browser. It closes the socket with code 1003 on a binary message or text it cannot parse, because it could not rewrite a token inside one. It also limits what one socket can use.

- It closes the socket with 1011 if more than 1,000 messages or 1 MiB wait for Realtime to accept the connection, or if that connection takes more than 10 seconds.
- It closes the socket with 1013 if more than 4 MiB of unsent data piles up on either side.
- It closes the socket with 1009 if the browser sends a message over 8 MiB, and with 1008 if the socket joins more than 100 channels.
- One session can hold at most 20 sockets on each replica. A further upgrade gets 429.

A refused upgrade carries the same status codes as a REST call, and a 401 carries `x-gw-session: expired`. Browsers cannot read the headers of a refused WebSocket handshake, so that marker is informational. The shim learns that the session has ended from its next REST call, which gets the same 401 with a marker it can read.

## Sign-in

1. The admin page calls `GET /bff/me`. Without a session it gets 401, and the sign-in page links to `/bff/login?return_to=<path>`.
2. `/bff/login` starts a GoTrue PKCE sign-in with the provider in `OIDC_IDENTIFIER` (default `custom:lfid`). It stores the PKCE verifier in a short-lived encrypted flow cookie and redirects to GoTrue's authorize URL.
3. GoTrue sends the user to the identity provider, then back to `/bff/callback`.
4. `/bff/callback` exchanges the code, checks the user's own `admin_profiles` row (`user_id`, `is_active`) with the user's token, stores the session in Redis and sets the session cookie. It then redirects to `return_to`, which must be a path on the same site. On an error it redirects to `/login?error=<code>`, with one of the codes below.
5. `POST /bff/logout` deletes the session, closes its sockets and clears the cookie. Before that, it asks GoTrue to revoke the refresh token, refreshing the session first if the access token has expired, because GoTrue checks the access token on that call. If GoTrue cannot be reached or refuses, the BFF logs it and still signs the user out. The refresh token then stays valid at GoTrue until it expires, but the BFF no longer has it. Sign-out does not end the identity provider's own session.

The sign-in page only ever receives these error codes. The details go to the BFF's log.

| Code | Meaning |
|---|---|
| `access_denied` | The identity provider returned `access_denied`, e.g. the user cancelled. |
| `login_failed` | The BFF could not start the sign-in. |
| `callback_invalid` | The identity provider or GoTrue returned any error other than `access_denied`, `server_error` or `temporarily_unavailable`. It also covers a callback with no code or no flow cookie, and a failed code exchange. |
| `server_error` | GoTrue returned `server_error` or `temporarily_unavailable`, the session could not be stored, or the client went over the sign-in rate limit. |
| `not_admin` | Reserved for the shim. The BFF does not redirect with it. |

A user who signs in but has no active `admin_profiles` row gets a session, and `/bff/me` answers 403 with their email so the sign-in page can show who they are. The BFF checks `admin_profiles` again on every token refresh, so removing a row takes effect within one token lifetime.

The check counts only a definite answer. An answer of 200 with no active row means the user is not an admin. Any other answer, or a network error or timeout, means the check could not be made. At sign-in and at refresh the BFF then keeps the tokens and marks the admin check as pending. While it is pending, the BFF answers 503 `admin_check_pending` with a `Retry-After` header instead of "not an admin", and repeats the check on the first request after 15 seconds. An open Realtime socket stays open while the check is pending.

`/bff/login` and `/bff/callback` are each limited to `ADMIN_BFF_SIGNIN_RATE_LIMIT` requests a minute (default 30) per client address, counted on each replica. Over the limit they redirect to `/login?error=server_error`, because the shim has no separate code for this.

The client address is the rightmost `X-Forwarded-For` entry that is not a trusted proxy. The BFF reads the list from the right, skips every address in `ADMIN_BFF_TRUST_PROXY`, and takes the first one left. When the connection does not come from a trusted proxy, the BFF ignores `X-Forwarded-For` and uses the connection's own address. The default trusts the loopback, link-local and private address ranges, which is where an in-cluster ingress controller connects from.

With that default, any pod in the cluster that can reach the BFF can claim any client address. If that matters to you, narrow `ADMIN_BFF_TRUST_PROXY` (`adminBff.trustProxy` in the chart) to the ingress controller's pods. If the path from the ingress to the BFF goes through source NAT, the BFF sees a node address instead, so trust the node addresses. To find these addresses, run the following commands. The namespace and label match the common nginx ingress install, so adjust them to yours.

```sh
kubectl get pods -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx -o wide
kubectl get nodes -o jsonpath='{range .items[*]}{.spec.podCIDR}{"\n"}{end}'
```

## Responses the browser can rely on

| Situation | Response |
|---|---|
| No session cookie, and the request does not use the `host-session` placeholder | The request is forwarded as the anon role. `/bff/me` answers 401 without the marker. |
| No session cookie, but the request uses the placeholder (`Authorization: Bearer host-session`, `?access_token=host-session` or `?token=host-session`), or opens a Realtime socket | 401 with the header `x-gw-session: expired`. Only code running after sign-in uses the placeholder, so the session has ended. |
| A session cookie whose session is gone (signed out elsewhere, refresh refused, cookie past its lifetime, or encrypted with a removed key) | 401 with the header `x-gw-session: expired`, and the cookie is cleared. |
| `/bff/me` when GoTrue answers 401, 403 or 404 for the user | The session is deleted, and the answer is 401 with `x-gw-session: expired`. |
| A signed-in user who is not an admin | 403 `{"error":"not_admin"}`, except for the public reads listed below. `/bff/me` answers 403 with `email`. |
| The admin check is pending (it could not be made) | 503 `{"error":"admin_check_pending"}` with `Retry-After` in seconds, on `/bff/me`, on proxied paths other than the public reads, and on a Realtime upgrade. |
| A request that fails the cross-site check below | 403 `{"error":"cross_site"}` |
| GoTrue cannot be reached, times out, or answers 408, 429 or 5xx (during a refresh, or on `/bff/me`), or Redis fails | 503 `{"error":"session_unavailable"}`. The session is kept, and the next request tries again. |
| The upstream cannot be reached or goes idle past `ADMIN_BFF_UPSTREAM_TIMEOUT_MS` | 502 |
| More than the sign-in rate limit on `/bff/login` or `/bff/callback` | A redirect to `/login?error=server_error` |

The browser shim signs the user out only when it sees `x-gw-session: expired`. A 401 from an upstream, e.g. an edge function that rejects a request, passes through without that header and does not sign the user out.

Requests without a cookie and without the placeholder are forwarded as the anon role because the admin reads some public data before sign-in. Examples are `platform_settings`, the `public_enabled_modules` and `lfid_sign_in_mode` functions, and public storage objects.

A signed-in user who is not an admin may still make a few public reads. These are forwarded as the anon role, which is what a signed-out browser gets.

- `GET` and `HEAD` of `/rest/v1/platform_settings`. The sign-in page reads it through the BFF for the logo, the theme and page transitions, so it has to keep working for this user.
- `GET` and `HEAD` of `/storage/v1/object/public/*`, and `GET`, `HEAD` and `POST` of `/rest/v1/rpc/public_enabled_modules` and `/rest/v1/rpc/lfid_sign_in_mode`, may also be read. As the anon role they show nothing that a signed-out browser cannot already see. `POST` is included because supabase-js calls functions with `POST`.

## Cross-site request checks

The session cookie is `SameSite=Lax`. On top of that, the BFF checks each proxied request as follows.

- For `POST`, `PUT`, `PATCH`, `DELETE` and any other method that can change data, the `Origin` header must be the admin's own origin or be absent. The request must also carry either `apikey` equal to the anon key or an `Authorization` header that starts with `Bearer `. Otherwise the BFF answers 403.
- For `GET` and `HEAD`, the same proof attaches the session. `Sec-Fetch-Site: same-origin` also attaches the session, because `EventSource`, `<img>` and some hand-written fetches cannot send `apikey`.
- A `GET` or `HEAD` that proves neither is forwarded as the anon role. It never gets the session, and it never gets a 403 that would show a session exists.
- A WebSocket upgrade needs `Origin` equal to the admin's origin.

The proof of concept accepted only `apikey`. On 2026-10-12 the rule was amended to also accept an `Authorization: Bearer` header, because about 280 hand-written calls in the admin and in modules send `Authorization: Bearer host-session` without `apikey`. Both headers give the same protection. A page on another site cannot add either header to a request without first sending a CORS preflight, and the BFF never answers a preflight with `Access-Control-Allow-*` headers. A plain form post from another site carries neither header and gets 403.

Only the `Bearer` scheme counts. Browsers send `Basic`, `Digest`, `NTLM` and `Negotiate` credentials on their own, without a preflight, e.g. when an ingress in front of the admin asks for basic authentication. Those headers prove nothing about where the request came from, so the BFF ignores them for this check.

## Cookies

On https the cookies are `__Host-gw-admin-session` and `__Host-gw-admin-flow`. Both are `Path=/`, `Secure`, `HttpOnly` and `SameSite=Lax`, with no `Domain`. The flow cookie lasts 10 minutes. Both are encrypted with `@fastify/secure-session` using `ADMIN_BFF_SESSION_SECRET`.

The session cookie lasts `ADMIN_BFF_SESSION_TTL_SECONDS` from the time it was last sent. When less than half of that time is left, the BFF sends the cookie again with a new time, so the cookie of an active session does not run out while Redis still holds the session.

On plain http the BFF accepts only `localhost`, `*.localhost` and `127.0.0.1`. There it uses the names `gw-admin-session` and `gw-admin-flow` without `Secure`, because browsers drop `__Host-` cookies over http. It refuses to start with any other http `ADMIN_URL`.

## Session store

Sessions live in the chart's Redis, under the key prefix `gw:admin-bff:`. Each session is kept for `ADMIN_BFF_SESSION_TTL_SECONDS`, and each refresh renews that time.

Each record is encrypted with AES-256-GCM, so the access and refresh tokens are never readable in Redis, which the API and the job queue also use. The key is derived from `ADMIN_BFF_SESSION_SECRET` with HKDF for this one purpose. The two cookies each get their own derived key too, so a value made for one use cannot be read as another. The session ID is bound into each record, so a record copied to another session's key does not decrypt. Rotation works the same way as for the cookies. The first key encrypts, and every key in the list decrypts. A record that does not decrypt is treated as an ended session, and the BFF logs it. A record that is not encrypted at all is deleted, because the BFF never reads plaintext tokens from Redis.

Refreshes take a Redis lock for 30 seconds, so one request refreshes while the others wait for its result. GoTrue gives out a new refresh token on each refresh, so only one request may refresh at a time. The lock is longer than the refresh call and the `admin_profiles` check together, which are 10 seconds each at most. A refreshed session is written only if it still exists, so a sign-out during a refresh stays signed out.

Sign-out is published on a Redis channel so every replica closes that session's Realtime sockets. A stored value with the wrong shape is treated as a session that has ended.

Restarting or flushing Redis signs every admin out.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `ADMIN_URL` | yes | Public origin of the admin, e.g. `https://admin.example.org`. |
| `SUPABASE_INTERNAL_URL` | yes | Supabase as the BFF reaches it, e.g. `http://supabase-kong:8000`. |
| `SUPABASE_PUBLIC_URL` | yes | Supabase as the browser reaches it. The BFF uses it for the GoTrue authorize URL. |
| `SUPABASE_ANON_KEY` | yes | The anon key. |
| `GATEWAZE_API_URL` | yes | The Gatewaze API origin for `/api/*`. |
| `REDIS_URL` | yes | `redis://:<password>@<host>:6379` or `rediss://...`. |
| `ADMIN_BFF_SESSION_SECRET` | yes | 64 hex characters (`openssl rand -hex 32`). It encrypts the session cookies and the session records in Redis. To rotate, put the new key first and keep the old one after a comma. The first key encrypts and every key decrypts. Keep the old key for at least `ADMIN_BFF_SESSION_TTL_SECONDS` after rotating, or every session it encrypted ends early. |
| `OIDC_IDENTIFIER` | no | GoTrue provider, default `custom:lfid`. |
| `ADMIN_BFF_SESSION_TTL_SECONDS` | no | Session lifetime, default 604800 (7 days). |
| `ADMIN_BFF_UPSTREAM_TIMEOUT_MS` | no | Idle timeout for a proxied request, default 300000. The ingress has its own timeout in front of this one. ingress-nginx closes a request that sends nothing back for 60 seconds by default, so a long edge function call ends there first. To raise it on the chart's ingress, add `nginx.ingress.kubernetes.io/proxy-read-timeout: "300"` and `nginx.ingress.kubernetes.io/proxy-send-timeout: "300"` to `ingress.annotations`. Those annotations apply to every host on the chart's ingress. |
| `ADMIN_BFF_SIGNIN_RATE_LIMIT` | no | Requests a minute per client address to `/bff/login` and to `/bff/callback`, default 30. Each replica counts on its own, so with the chart's default of 2 replicas one address can make about twice this many. |
| `ADMIN_BFF_TRUST_PROXY` | no | Comma-separated proxies whose `X-Forwarded-For` is trusted: names (`loopback`, `linklocal`, `uniquelocal`), addresses or CIDR ranges. Default `loopback,linklocal,uniquelocal`. |
| `PORT`, `HOST`, `LOG_LEVEL` | no | Defaults `3001`, `0.0.0.0`, `info`. |

The admin itself needs these values in host-session mode:

| Variable | Value |
|---|---|
| `VITE_AUTH_MODE` | `host-session` |
| `VITE_SUPABASE_URL` | The admin's own origin |
| `VITE_SUPABASE_PUBLIC_URL` | The real Supabase URL, for OAuth redirect URIs, links in emails and storage URLs that get saved |
| `VITE_API_URL` | The admin's own origin, so `/api` calls stay on the admin origin |

GoTrue must allow `<ADMIN_URL>/bff/callback` as a redirect URL. For self-hosted Supabase, add it to `ADDITIONAL_REDIRECT_URLS`. The provider in `OIDC_IDENTIFIER` must be registered in GoTrue. Custom OIDC providers such as `custom:lfid` need Supabase Auth v2.187 or later.

The BFF never writes cookies, `Authorization`, `apikey`, or token values in the query string to its logs.

As a backstop only, the server logs any exception that escaped every handler and exits, and Kubernetes restarts the pod. The errors the BFF expects, such as a client resetting a WebSocket handshake, are handled where they happen.

## Kubernetes

The chart has two flags under `adminBff`. Both default to `false`, and with both off the chart renders exactly as it did before the BFF was added.

```yaml
adminBff:
  enabled: true        # deploy the BFF (Deployment, Service, PodDisruptionBudget)
  switchAdmin: true    # point the admin and the admin ingress rule at it
  sessionSecret: "<openssl rand -hex 32>"
  # provider: custom:lfid
  # sessionTtlSeconds: 604800
  # supabaseInternalUrl: http://supabase-kong:8000   # default: supabase.url
  # trustProxy: "10.244.0.0/16"                      # default: BFF default
  # signInRateLimit: 30
  # upstreamTimeoutMs: 300000
```

Turn on `enabled` first and check that `/bff/healthz` answers. Then turn on `switchAdmin`. The render fails if `switchAdmin` is on without `enabled`, without `ingress.enabled`, or if `enabled` is on without a 64 hex character `sessionSecret`. With `existingSecret`, put `ADMIN_BFF_SESSION_SECRET` in your Secret instead.

The BFF pod reads only three keys from the Secret, each through its own `secretKeyRef`. These keys are `SUPABASE_ANON_KEY`, `REDIS_URL` and `ADMIN_BFF_SESSION_SECRET`. It never sees the service role key. It runs as a non-root user with a read-only root filesystem.

## Docker Compose

The compose stack has an `admin-bff` service in the `host-session` profile. To try it, set these in `docker/.env`. The commented block in `docker/.env.example` has the same values.

```sh
VITE_AUTH_MODE=host-session
ADMIN_VITE_SUPABASE_URL=http://admin.gatewaze.localhost
ADMIN_VITE_API_URL=http://admin.gatewaze.localhost
ADMIN_BFF_SESSION_SECRET=<openssl rand -hex 32>
# ADMIN_BFF_PROVIDER=custom:lfid
```

Set `ADMIN_VITE_API_URL` to the admin URL, not to an empty value. Compose treats an empty value as unset and falls back to `API_URL`, which would send `/api` calls past the BFF.

Add `http://admin.gatewaze.localhost/bff/callback` to `ADDITIONAL_REDIRECT_URLS`, then run `docker compose --profile host-session up -d`. Traefik sends `/bff` and the proxied paths on the admin host to the BFF. The compose stack's GoTrue is v2.186.0, which is older than custom OIDC provider support. To sign in with `custom:lfid` locally you need a newer GoTrue, or you can set `ADMIN_BFF_PROVIDER` to a provider that GoTrue already has.

## Using the core from another server

The package exports its framework-free core as `@gatewaze/admin-bff/core`. It contains the session handling, the Redis store, the request and cross-site rules, the proxy and the Realtime bridge. A host with its own server, e.g. LFX One's Express server, can wrap these in its own routes the way `src/app.ts` does for Fastify.

## Where this differs from the proof of concept

- The BFF proxies Storage, edge functions and the Gatewaze API as well as PostgREST and Realtime. It reaches each upstream over http or https with pooled connections.
- It does not serve the admin page. The admin nginx container still does that.
- Requests without a cookie and without the placeholder are forwarded as the anon role. A gone session, or the placeholder without a cookie, answers 401 with `x-gw-session: expired`. The proof of concept answered 401 to all of these.
- `GET` and `HEAD` can prove they are same-origin with `Sec-Fetch-Site`, and a cross-site `GET` is forwarded as anon instead of rejected. Unsafe methods also accept an `Authorization: Bearer` header in place of `apikey`. Both changes are described above.
- Query tokens are removed instead of replaced with the real token, and `token` is removed only when it is the placeholder. Storage signed URLs and some edge functions use `token` for their own signed values.
- The store uses ioredis and the chart's Redis instead of Valkey GLIDE. Keys have the prefix `gw:admin-bff:`, and records are encrypted. The refresh lock lasts 30 seconds and is released only by the request that holds it. A refresh does not write back a session that was deleted meanwhile.
- When GoTrue cannot be reached during a refresh, the session is kept and the request gets 503. The proof of concept signed the user out. The refresh calls GoTrue's token endpoint directly, because supabase-js retries a failed refresh for up to 30 seconds.
- A failed `admin_profiles` check is marked pending and answers 503 `admin_check_pending` until it is retried 15 seconds later, at sign-in and at refresh. In the proof of concept a non-200 answer counted as not an admin, and a network error signed the user out.
- `/bff/me` ends the session when GoTrue refuses the user's token, and answers 503 when GoTrue gives no answer.
- The sign-in routes are rate limited, the cookies and the Redis records each use their own derived key, and an upstream redirect to another host loses its `Location` header.
- A signed-in user who is not an admin may make the sign-in page's public reads as anon.
- The cookies use `__Host-` names, so the flow cookie has `Path=/` instead of `/bff`. The session cookie has a maximum age equal to the session lifetime and is sent again at half-life.
- Sign-in errors go to `/login?error=<code>` with fixed codes instead of `/?error=<message>`. Signing in again ends the previous session. Sign-out refreshes an expired access token first so GoTrue can revoke the refresh token.
- Proxied paths are checked after `..` segments are resolved, so a request cannot reach a different upstream path such as `/auth/v1`.
- Responses made with the session are marked private for caches. The Realtime bridge refuses frames it cannot rewrite and limits its memory use and sockets per session.
