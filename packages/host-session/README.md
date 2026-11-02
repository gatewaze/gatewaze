# @gatewaze/host-session

`@gatewaze/host-session` is the core of a Gatewaze session holder. A session holder is a server that keeps a user's Supabase session on the server side. The browser holds only a cookie with a session ID, and the server attaches the real access token to every request it forwards to Supabase, the Gatewaze API and Supabase Realtime.

The package has no HTTP framework in it. Each host wraps it with a thin adapter for its own framework:

- The Gatewaze admin BFF (`packages/admin-bff`) wraps it for Fastify. Read `packages/admin-bff/src/app.ts` for a complete, tested adapter.
- LFX One wraps it for Express 4 and `express-openid-connect`.

The package is ESM only and needs Node 20 or later. Its runtime dependencies are `ws` and `ioredis`. It talks to GoTrue and PostgREST with plain `fetch`, so it does not need `@supabase/supabase-js`. TypeScript hosts also need `@types/node` and `@types/ws`, because the public types use `IncomingMessage` and `WebSocket`.

## What is in it

| Area | Exports |
|---|---|
| Sign-in and refresh | `signInWithIdToken`, `toGwSession`, `refreshSession`, `isAdmin`, `getAdminContext`, `getUser`, `logout`, `needsRefresh`, `isAdminCheckPending`, `retryAfterSeconds`, `identitySubject`, `unverifiedJwtSubject` |
| Session store | `SessionStore` (`create`, `put`, `acquire`, `get`, `fresh`, `delete`, `discard`, `onDelete`, `start`, `close`), `RedisKeyValue`, the `KeyValue` interface, `isGwSession` |
| Keys | `deriveKeys`, `seal`, `open` |
| Request rules | `csrfDecision`, `carriesPlaceholder`, `isPublicRead`, `stripQueryTokens`, `safeReturnTo`, `redactUrl`, `forwardRequestHeader`, `forwardResponseHeader`, `privateCacheControl` |
| Proxy | `proxyRequest`, `upstreamUrl`, `upstreamHeaders`, `forwardedFor`, `rewriteLocation`, `anonCredentials`, `isPublishableKey`, `rejectUpgrade`, `realtimeUpstreamUrl` |
| Realtime | `bridgeRealtime` |
| Errors | `SessionUnavailableError` and its subclasses `RefreshUnavailableError` and `IdTokenGrantUnavailableError`, `IdTokenGrantRefusedError`, `SessionEndedError`, `AdminCheckError`, `UpstreamPathError`, and `errorMessage` |
| Constants | `HOST_SESSION`, `SESSION_HEADER`, `SESSION_EXPIRED`, `KEY_PREFIX`, `LOGOUT_CHANNEL`, `LOCK_MS`, `CREATE_LOCK_MS`, `MINT_TIMEOUT_MS`, `SIGNED_OUT_TTL_SECONDS`, `REFRESH_SKEW_SECONDS`, `DEFAULT_PROVIDER`, `ADMIN_PROFILE_COLUMNS` and the timeouts |

The types are `HostSessionConfig`, `GwSession`, `GoTrueUser`, `AdminProfile`, `AdminContext`, `SessionStoreOptions`, `SessionMatchOptions`, `AcquireOptions`, `DiscardOptions`, `IdTokenGrantOptions`, `SetIfLockHeldResult`, `Upstream`, `ProxyCredentials`, `ProxyOptions`, `ProxyResult`, `RealtimeBridge`, `RealtimeBridgeOptions` and `CoreLogger`.

## Signing in with an ID token

A host that already signed the user in with the IdP can turn an ID token into a Supabase session without a second browser redirect.

```ts
const session = await signInWithIdToken(cfg, idToken);
```

This posts `{ provider, id_token }` to `/auth/v1/token?grant_type=id_token` with the `apikey` header. The provider is `cfg.provider`, or `custom:lfid` when that is not set.

The session then goes through `toGwSession`, the same step every PKCE sign-in and refresh uses. It reads `admin_profiles` with the user's own token. When that read can't be made, the session comes back with `admin_check: 'pending'`, `is_admin: false` and a short expiry, so the next request refreshes it and tries the check again. The session also records `sub`, the ID token's subject, which the store uses to bind the session to the user (see below).

Errors fall into two classes, as they do for a refresh:

- `IdTokenGrantRefusedError` is thrown on a 4xx other than 408 and 429. The token was refused, and trying again with it will not help. Send the user back through sign-in.
- `IdTokenGrantUnavailableError` is thrown on a network error, a timeout, a 5xx, a 408, a 429, or a 200 that holds no session. Answer 503. It extends `SessionUnavailableError`.

The grant call is bounded at 10 seconds by default. A `timeoutMs` above 20 seconds is clamped to 20, so the grant and the admin check always fit inside one mint under `acquire()`.

### Which ID token to send

GoTrue checks the token's issuer, audience and signature against the provider it has configured, and it checks the nonce. If the token has a `nonce` claim, GoTrue requires the request to carry a raw nonce whose SHA-256 hex digest equals the claim. If the token has no `nonce` claim, the request must not carry one.

The ID token `express-openid-connect` receives at sign-in always has a raw nonce claim that GoTrue can't match, so do not send that token. The supported path is:

- Get the ID token from an Auth0 `refresh_token` grant with `scope=openid email profile` and no `audience`. That token carries no nonce, so leave `nonce` unset.
- Keep `skip_nonce_check` off on the GoTrue provider.
- Configure the GoTrue provider with the host's Auth0 client ID in `acceptable_client_ids`, and with the issuer that Auth0 puts in the token.

## The session store

The store keeps sessions in Redis or Valkey. Every record is encrypted with AES-256-GCM, and the session ID is bound into the encryption, so a record copied under another ID does not decrypt. Encryption is required. The constructor throws without keys.

```ts
const store = await SessionStore.connect(cfg, process.env.REDIS_URL, {
  keys: deriveKeys(masterKeys, 'store'),
  keyPrefix: 'lfx-one:host-session:',
  ttlSeconds: 8 * 3600,
  onError: (err) => log.error({ err: err.message }, 'redis error'),
});
```

`keyPrefix` puts every key and the sign-out channel under the host's own name. The default, `gw:admin-bff:`, is the admin BFF's. Every other host must set its own prefix, even when it has a Redis to itself. An empty prefix is refused. `LOGOUT_CHANNEL` is the sign-out channel for the default prefix only. A store with its own prefix publishes on `<keyPrefix>logout`.

On Redis Cluster, the prefix must contain a hash tag, e.g. `{lfx}:gw:`. The script that stores a minted session reads and writes three keys (the session, the create lock and the sign-out marker), and Cluster runs a script only when all its keys are in one slot.

There are three ways to store a session:

- `create(session)` stores it under a new random ID and returns the ID.
- `put(sid, session)` stores it under an ID the host chose. It replaces any session already there.
- `acquire(sid, mint, opts)` returns the session stored under `sid`, refreshed if needed. When there is none, it calls `mint()` and stores the result.

`acquire` runs only one mint at a time for an ID, across every instance. It takes a `create-lock:<sid>` lock with `SET NX` for 35 seconds. The mint gets 30 seconds, which is enough for three calls bounded at 10 seconds each. A mint that takes longer fails with `SessionUnavailableError`, and its late result is revoked at GoTrue instead of stored. Other callers poll and get the session the first caller stored. If the mint throws, the lock is released and the error goes to that caller, and the next caller mints for itself. A caller that can't get a session or the lock within `waitMs` (35 seconds by default) gets a `SessionUnavailableError`.

The store writes the minted session with a Lua script that writes it only while the caller still holds the create lock and no sign-out has happened. Otherwise the minted session is revoked at GoTrue and `acquire` throws, `SessionEndedError` for a sign-out and `SessionUnavailableError` for a lost lock.

`fresh(sid)` returns a session whose token is valid for at least another 60 seconds. It refreshes under a lock, because GoTrue rotates refresh tokens. It returns null and deletes the session when GoTrue refuses the refresh, and it throws `RefreshUnavailableError` when GoTrue can't be reached.

`delete(sid)` is the sign-out. It deletes the session, tells every instance so `onDelete` listeners (open Realtime bridges) close, and writes a sign-out marker for 5 minutes. A mint already running for that ID then can't store its result, and any `acquire()` on that ID throws `SessionEndedError` until the marker expires.

`discard(sid)` deletes the session and tells every instance in the same way, but writes no marker, so the next `acquire()` on that ID can mint straight away. It does not revoke the session at GoTrue. Call `logout()` first if you want that. It also does not stop a mint that is already running on that ID, and it does not clear a marker that `delete` wrote. A mint in flight can still store its result after `discard`, so `discard` must never stand in for a real sign-out.

Pass `{ onlyIfAccessToken }` with the access token of the session you saw refused. `discard` then removes the record only while it still holds that token, and resolves `true` when it did. Without the guard, a stale browser tab that sees its old session refused could wipe a session another tab has just minted on the same ID, and that session would never be revoked. The check is atomic. The store decrypts the record, compares the token, and then deletes only if Redis still holds that exact ciphertext. Every write seals with a new IV, so any write in between makes the delete a no-op.

Use them like this:

- Use `delete` for a real sign-out, where the session must not come back on that ID, e.g. the host's own logout route.
- Use `discard` to drop a record GoTrue no longer honours, e.g. when GoTrue's `/user` refuses the token, so the next request mints a new session. This applies to hosts that mint with `acquire()`. The admin BFF has no mint path and makes a new ID at every sign-in, so it correctly uses `delete` there.
- Use `discard` for a reconnect, where the user stays signed in to the host but the Gatewaze session should end, e.g. a sign-out from inside the embedded admin.

The marker only lasts 300 seconds. With a stateless cookie session (e.g. `express-openid-connect`'s encrypted `appSession`), an old copy of the cookie still carries the old ID after that, so a host must not rely on the marker alone. Rotate the ID at every sign-in, as the rules below say, so a signed-out ID is never used to mint again.

### Binding a session to the user

Pass the signed-in user's IdP subject as `expectedSub` to `acquire`, `fresh` and `get`. A stored session for any other subject, or one with no subject recorded, is deleted and treated as missing, and `acquire` mints a new one. The store also tries to revoke it at GoTrue. It refreshes the session first when its token is expired or close to it, because GoTrue's logout needs a valid access token. This revoke is best effort: a failed refresh or logout is logged and the session is still deleted. A minted session for another subject is revoked and refused with `SessionEndedError`.

The session ID itself must follow these rules:

- It is at least 32 random bytes, or an HMAC of a per-login random value. It is never derived from user data such as the user ID or email.
- It is created once per IdP sign-in, at the sign-in callback, and replaced on every IdP sign-in.
- It is dropped on sign-out. After `delete(sid)` the same ID can't hold a session for 5 minutes, so the next sign-in must use a new one.

## The host contract

A host must do these things. The admin BFF's `src/app.ts` does each of them.

1. Keep the session ID in an HttpOnly, Secure, SameSite=Lax cookie, follow the session ID rules above, and never send a token to the browser.
2. Answer `SessionUnavailableError` (and any Redis failure) with 503, never with a sign-out.
3. For each proxied request, call `csrfDecision`. Answer `reject` with 403. For `anon`, forward without the session.
4. For `session`, load the session with `store.fresh(sid, { expectedSub })`, or `store.acquire(sid, mint, { expectedSub })`. When it is gone, or there is no cookie but `carriesPlaceholder` is true, answer 401 with the `x-gw-session: expired` header. Answer `SessionEndedError` the same way.
5. Attach the session's token only when `is_admin` is true. A non-admin may still make `isPublicRead` requests, as anon. Otherwise answer 503 with `Retry-After` when the admin check is pending, and 403 when it is not.
6. Forward with `proxyRequest`. Use `{ bearer: session.access_token, apikey: anonKey }` for a session, and `anonCredentials(anonKey, upstream.supabase)` without one. Set `privateResponse` when the session was attached. Answer `UpstreamPathError` with 400 and other errors with 502.
7. For Realtime, check `Origin`, load the session, build the URL with `realtimeUpstreamUrl`, and hand the accepted socket to `bridgeRealtime` with `fresh: () => store.fresh(sid, { expectedSub })` and `onSignedOut: (fn) => store.onDelete(sid, fn)`.
8. On sign-out, load the session (refreshing it if needed), call `logout(cfg, session)` to revoke the refresh token at GoTrue, then call `store.delete(sid)` and drop the session ID. When the user stays signed in to the host and only the Gatewaze session ends, call `store.discard(sid)` instead, and keep the ID.

### The session route (/me)

The embedded admin asks the host's session route (`GwHostContext.session.meUrl`) who is signed in:

- 200 `{ user }` for an admin, where `user` is GoTrue's user (from `getUser`).
- 401 signed out, with `x-gw-session: expired` when the cookie's session is gone.
- 403 `{ error: 'not_admin', email }` for a signed-in non-admin.
- 503 `{ error: 'admin_check_pending' }` with `Retry-After` while the admin check is pending, and 503 `{ error: 'session_unavailable' }` when the store or GoTrue cannot answer.

Since 1.2.0 the 200 may also carry `admin`, the user's admin profile and the features granted to them:

```ts
// After the 401 and admin_check_pending answers above. getAdminContext never
// rejects (it resolves null on any failure), so it can start before getUser.
const admin = session.is_admin
  ? getAdminContext(cfg, session.access_token, session.user_id)
  : Promise.resolve(null);
const user = await getUser(cfg, session.access_token); // SessionEndedError -> 401, other errors -> 503
if (!session.is_admin) return res.status(403).json({ error: 'not_admin', email: user.email });
const adminContext = await admin;
return res.json(adminContext ? { user, admin: adminContext } : { user });
```

```json
{
  "user": { "id": "…", "email": "…" },
  "admin": {
    "profile": { "id": "…", "user_id": "…", "email": "…", "name": "…", "role": "admin", "avatar_url": null,
                 "is_active": true, "created_at": "…", "updated_at": "…" },
    "features": ["newsletters", "broadcasts"]
  }
}
```

`getAdminContext` reads the active `admin_profiles` row (the `ADMIN_PROFILE_COLUMNS`) and `rpc/admin_get_features` with the user's own token, in parallel, each bounded at 3 seconds. It resolves `null` instead of throwing when either read fails, when there is no active row or more than one, or when an answer is not the expected shape. Leave `admin` out then.

A host that builds the field itself must send it in exactly this shape, or the admin ignores it (and logs a warning in the browser console). All nine profile fields must be present. `id` is a non-empty string. `name` and `avatar_url` are a string or `null`, never missing. `is_active` is `true`. `profile.user_id` equals `user.id`. `features` is an array of strings.

`features` must be exactly what `admin_get_features(user.id)` returns: every feature that `admin_has_feature_permission` answers true for when no account is given, from direct and group grants alike. The admin answers its account-less permission checks from this list, both allowed and denied, without asking the database, so a list built any other way grants or denies the wrong pages for up to a minute. The field is optional: an admin from before it existed ignores it, and an admin that gets no `admin` reads the profile and permissions itself, as before. With it, the embed skips one profile read and one permission call per route before its first render. Only call it for a session whose `is_admin` is true.

### Anon requests and publishable keys

`anonCredentials` sends a legacy JWT anon key in `apikey` and as `Authorization: Bearer`, which is what supabase-js sends when signed out. A `sb_publishable_` key is not a JWT, and Supabase may reject one sent as a bearer token, so `anonCredentials` sends it in `apikey` only. Non-Supabase upstreams get neither.

### Wrapping the request body

`proxyRequest` streams `req` to the upstream. Pass `body` to send a different stream, e.g. the request piped through a byte limit. If that stream emits an error, the upstream request is aborted and `proxyRequest` rejects with the same error, so the host can answer 413. This only works while the upstream has not answered yet. Once the response headers have been sent to the browser, the host can only close the connection.

## Express adapter sketch

This sketch shows the shape of an Express 4 host that signs in with `express-openid-connect`. It is not complete. It leaves out the Realtime upgrade and logging, and it does not handle every case in the host contract above. `auth0IdToken(req)` stands for the host's own call to Auth0's token endpoint with `grant_type=refresh_token`, `scope=openid email profile` and no audience, which returns the new `id_token`.

```ts
import crypto from 'node:crypto';
import { Transform, pipeline } from 'node:stream';
import express from 'express';
import { auth } from 'express-openid-connect';
import {
  type HostSessionConfig,
  IdTokenGrantRefusedError,
  SESSION_EXPIRED,
  SESSION_HEADER,
  SessionEndedError,
  SessionStore,
  SessionUnavailableError,
  UpstreamPathError,
  anonCredentials,
  csrfDecision,
  deriveKeys,
  errorMessage,
  forwardedFor,
  isAdminCheckPending,
  isPublicRead,
  logout,
  proxyRequest,
  retryAfterSeconds,
  signInWithIdToken,
  upstreamUrl,
} from '@gatewaze/host-session';

const cfg: HostSessionConfig = { supabaseUrl: SUPABASE_INTERNAL_URL, anonKey: SUPABASE_ANON_KEY };
const store = await SessionStore.connect(cfg, REDIS_URL, {
  keys: deriveKeys(MASTER_KEYS, 'store'),
  keyPrefix: 'lfx-one:host-session:',
});
const supabase = { url: SUPABASE_INTERNAL_URL, prefix: '/rest/v1', supabase: true };

// A new session ID on every IdP sign-in, minted once at the callback and
// kept in the encrypted appSession cookie. Never created lazily per request:
// two first requests would get different IDs and mint twice.
app.use(
  auth({
    ...oidcConfig,
    afterCallback: (_req, _res, session) => ({ ...session, gwSid: crypto.randomBytes(32).toString('base64url') }),
  }),
);

class TooLargeError extends Error {}
function byteLimit(max: number) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      cb(seen > max ? new TooLargeError() : null, chunk);
    },
  });
}

const expired = (res: express.Response) =>
  res.status(401).set(SESSION_HEADER, SESSION_EXPIRED).json({ error: 'not_signed_in' });

app.all('/gw/rest/v1/*', async (req, res) => {
  const pathAndQuery = req.originalUrl.slice('/gw'.length);
  const decision = csrfDecision({
    method: req.method,
    origin: req.get('origin'),
    apikey: req.get('apikey'),
    authorization: req.get('authorization'),
    secFetchSite: req.get('sec-fetch-site'),
    siteOrigin: SITE_ORIGIN,
    anonKey: cfg.anonKey,
  });
  if (decision === 'reject') return res.status(403).json({ error: 'cross_site' });

  let creds = anonCredentials(cfg.anonKey, true);
  let privateResponse = false;
  try {
    if (decision === 'session' && req.oidc.isAuthenticated()) {
      const sid = req.appSession?.gwSid;
      const expectedSub = req.oidc.user?.sub;
      if (!sid || !expectedSub) return expired(res);
      const s = await store.acquire(sid, async () => signInWithIdToken(cfg, await auth0IdToken(req)), { expectedSub });
      if (s.is_admin) {
        creds = { bearer: s.access_token, apikey: cfg.anonKey };
        privateResponse = true;
      } else if (!isPublicRead(req.method, upstreamUrl(supabase, pathAndQuery).pathname)) {
        if (isAdminCheckPending(s)) {
          return res.status(503).set('retry-after', String(retryAfterSeconds(s))).json({ error: 'admin_check_pending' });
        }
        return res.status(403).json({ error: 'not_admin' });
      }
    }
    const up = await proxyRequest(req, supabase, pathAndQuery, {
      creds,
      xff: forwardedFor(req.get('x-forwarded-for'), req.socket.remoteAddress),
      timeoutMs: 300_000,
      downstream: res,
      privateResponse,
      siteOrigin: SITE_ORIGIN,
      body: req.pipe(byteLimit(10 * 1024 * 1024)),
    });
    res.status(up.status).set(up.headers);
    pipeline(up.body, res, () => undefined);
  } catch (e) {
    // After the headers are out, the only answer left is to close.
    if (res.headersSent) return res.destroy();
    if (e instanceof IdTokenGrantRefusedError || e instanceof SessionEndedError) return expired(res);
    if (e instanceof SessionUnavailableError) return res.status(503).json({ error: 'session_unavailable' });
    if (e instanceof UpstreamPathError) return res.status(400).json({ error: 'bad_path' });
    if (e instanceof TooLargeError) return res.status(413).json({ error: 'too_large' });
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
});

// Sign-out: revoke at GoTrue, then delete, which also stops any mint in
// flight from storing its result. The appSession, and the ID with it, goes
// even when Redis fails, so the browser is signed out regardless.
app.post('/gw/logout', async (req, res) => {
  // As in admin-bff: a cross-site page must not be able to sign the user out.
  const origin = req.get('origin');
  if (origin && origin !== SITE_ORIGIN) return res.status(403).json({ error: 'cross_site' });
  const sid = req.appSession?.gwSid;
  try {
    if (sid) {
      const s = await store.fresh(sid).catch(() => store.get(sid));
      if (s) await logout(cfg, s);
      await store.delete(sid);
    }
  } catch (e) {
    log.warn({ err: errorMessage(e) }, 'sign-out: could not end the stored session');
  }
  res.oidc.logout();
});
```

The proxied route must not run behind a body parser such as `express.json()`, because `proxyRequest` reads the raw request stream.

The sign-out route uses `store.delete(sid)` because it ends the host session too. Two other cases call for `store.discard(sid)`:

- When `getUser(cfg, s.access_token)` throws `SessionEndedError`, GoTrue no longer honours the session. Call `store.discard(sid, { onlyIfAccessToken: s.access_token })` and let the next `acquire()` mint a new one from a fresh ID token.
- When the embedded admin signs out but the user stays signed in to LFX One, revoke with `logout(cfg, s)` and then call `store.discard(sid, { onlyIfAccessToken: s.access_token })`. The host keeps the same ID, and the next request mints again.

## Development

```sh
pnpm --filter @gatewaze/host-session build
pnpm --filter @gatewaze/host-session test
```

The Redis integration tests run only when `REDIS_TEST_URL` is set:

```sh
docker run --rm -d -p 6390:6379 --name hs-valkey valkey/valkey:8-alpine
REDIS_TEST_URL=redis://127.0.0.1:6390 pnpm --filter @gatewaze/host-session test
docker stop hs-valkey
```

`@gatewaze/admin-bff` depends on this package through the workspace and imports it from `dist`, so build this package before you typecheck or test the BFF.

## Publishing

Bump `version` in `package.json`, merge, then run the `Publish host-session` workflow (`.github/workflows/publish-host-session.yml`) on `main`. Its first job installs a narrowed workspace from the frozen lockfile without install scripts, runs the unit tests, builds and packs the tarball. Its second job runs in the protected `npm` environment and publishes that tarball with npm provenance. Run it with `dry_run` first to see what would be packed.

## Licence

Apache-2.0.
