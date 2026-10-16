# @gatewaze/admin-embed

Loader for the embeddable Gatewaze admin. A Gatewaze deployment serves a library build of its
admin at `https://<admin host>/embed/`; this package mounts it into a DOM node of your own
application — no iframe — and keeps your application out of the admin's release cycle.

```ts
import { mount } from '@gatewaze/admin-embed';

const handle = mount(element, {
  source: { baseUrl: 'https://admin.example.org/embed' },
  basename: '/foundation/gw',
  supabase: { url, anonKey },
  apiBaseUrl: '', // '' means same-origin /api/gw
  enabled: { moduleIds: [...], features: [...] },
  signIn: { startUrl, returnUrl },
  portalContainer: portalsElement, // where overlays render
  notify: (n) => hostToast(n), // optional: render admin toasts as yours
  loadingIndicator: () => hostSpinnerElement(), // optional: show your spinner, not ours
  onFatal: (err) => report(err),
});

const manifest = await handle.ready; // null if loading failed (see onFatal)
await handle.rendered; // the pane is no longer blank: hide your own loading state now
handle.unmount();
```

`mount()` returns synchronously and never throws. It reads the deployment's
`manifest.json` and checks that the bundle implements the host contract this loader was built
for. It then fetches the stylesheet and imports the entry at the same time, and mounts once both
are in. Every failure reports through `onFatal` and resolves `ready` with `null`; calling
`unmount()` before `ready` cancels the mount.

`ready` resolves when the embed has been mounted, which is before React has painted anything.
`rendered` (loader 1.2.0 and later) resolves once the embed has put its first route content or
loading spinner on screen, so a host can swap its own skeleton for the embed without a blank pane
in between. It needs a deployment whose manifest lists the `first-paint` capability. Against an
older deployment it resolves when `ready` does. It also resolves when loading fails, when the
embed reports a fatal error after mounting, on `unmount()`, and after 10 seconds without a
signal, so it never leaves a host waiting. It never rejects.

## Why a loader

The admin bundle is served by the same deployment as the API and database it was built against,
so a deployment ships the embed in lockstep with its backend. Your application picks up admin
changes on the next page load, with no release of its own. Only a change to the host contract
(`EMBED_CONTRACT`, exported here and stamped into the manifest) requires upgrading this package —
until then a newer bundle is loaded as-is, and an incompatible one is refused with
`gw_embed_contract_mismatch` rather than mounted.

Optional features are listed in the manifest's `capabilities` array instead of changing the
contract. When your context sets `session: { mode: 'host', ... }` (the host holds the Gatewaze
session), the loader checks that the manifest lists `host-session`. A deployment built before that
feature is refused with `gw_embed_capability_missing`, so the embed never falls back to keeping a
session in the browser's localStorage. Manifests without `capabilities` still load in the default
mode.

The other capabilities are optional features a host can use when they are listed:

| Capability | What it means | Without it |
|---|---|---|
| `host-session` | The bundle honours `session`. | A host-session context is refused (`gw_embed_capability_missing`). |
| `first-paint` | The bundle dispatches a `gw-embed:first-paint` event (exported as `FIRST_PAINT_EVENT`) on the mount element once, after its first route content or loading spinner has committed. The loader turns it into `handle.rendered`. | `rendered` resolves with `ready`. |
| `host-loading-indicator` | The bundle honours `loadingIndicator`. Each page-level loading state calls it and mounts the returned element in place of the embed's own spinner, in the same centred box, inside a `role="status"` wrapper with a visually hidden "Loading" label. Return a new, decorative (`aria-hidden="true"`) element on every call. A factory that throws or returns something other than an element falls back to the embed's spinner. | The loader leaves `loadingIndicator` out of the context, and the embed shows its own spinner. |

In host-session mode `supabase.url` is your own proxy, so also pass `supabase.publicUrl`, the real
Supabase project URL (https, or http on localhost). The embed uses it for public storage URLs and
OAuth redirect URIs, so image URLs that modules save point at Supabase rather than at your proxy.

## Stylesheet

The stylesheet is fetched and injected as a `<style>` element (in `document.head` unless
`source.stylesheetTarget` says otherwise). It ships unscoped. An application that renders the
admin inside its own chrome has two ways to scope it:

- `source.transformStylesheet(css)` rewrites the text in the browser before injection.
- `source.resolveStylesheetUrl(url)` swaps the manifest's stylesheet URL for one of the
  application's own, e.g. a server endpoint that fetches the hashed file, scopes it once and
  caches it. The loader fetches whatever URL comes back.

The element is keyed on the fetched URL, so re-mounts reuse it and a new build gets a fresh one.

## Preloading

A manifest may carry `preload`, the chunks the entry imports statically (its whole static import
graph, the entry itself left out). Loader 1.2.0 and later add a `<link rel="modulepreload">` for
each one while the entry downloads, so the browser fetches them in parallel instead of finding
them one import at a time. Every file is held to the same rule as the entry: it must resolve to the
`source.baseUrl` origin, or the manifest is refused. At most 64 are used. When the host supplies
`source.importEntry` (its own module loading, for a CSP nonce say), no preload links are added.
Older loaders ignore the field, as they ignore any manifest field they do not know.

## Serving the embed

The admin image builds and serves the bundle when `ADMIN_EMBED_MODULES` names the modules to
compile in (a module and everything it depends on — the build does not resolve dependencies):

```
ADMIN_EMBED_MODULES=newsletters,content-platform,host-media,templates,editor-ai-copilot,broadcasts
```

`/embed/manifest.json` is served `no-store`; everything else under `/embed/` is content-hashed
and immutable, with CORS open to any origin (the bundle is public code — credentials and data
live behind the API and Supabase).

The embed is built once per image and is the same on every replica: a host may read the manifest
from one replica and fetch a file from another (its server scoping the stylesheet, say), so the
replicas must agree. The admin SPA's per-pod boot refresh deliberately leaves the embed alone;
embed changes ship as a new image.

## Building this package

```bash
node packages/admin-embed/scripts/build.mjs
```

The contract types and `EMBED_CONTRACT` are copied from `packages/admin/src/embed/` at build
time, never hand-written, so the published contract cannot drift from the one the admin
implements. The output is a single self-contained ES module plus declarations.
