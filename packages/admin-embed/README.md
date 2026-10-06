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
  onFatal: (err) => report(err),
});

const manifest = await handle.ready; // null if loading failed (see onFatal)
handle.unmount();
```

`mount()` returns synchronously and never throws. It reads the deployment's
`manifest.json`, checks that the bundle implements the host contract this loader was built for,
injects the stylesheet, imports the entry and mounts it. Every failure reports through `onFatal`
and resolves `ready` with `null`; calling `unmount()` before `ready` cancels the mount.

## Why a loader

The admin bundle is served by the same deployment as the API and database it was built against,
so a deployment ships the embed in lockstep with its backend. Your application picks up admin
changes on the next page load, with no release of its own. Only a change to the host contract
(`EMBED_CONTRACT`, exported here and stamped into the manifest) requires upgrading this package —
until then a newer bundle is loaded as-is, and an incompatible one is refused with
`gw_embed_contract_mismatch` rather than mounted.

## Stylesheet

The stylesheet is fetched and injected as a `<style>` element (in `document.head` unless
`source.stylesheetTarget` says otherwise). It ships unscoped. An application that renders the
admin inside its own chrome has two ways to scope it:

- `source.transformStylesheet(css)` rewrites the text in the browser before injection.
- `source.resolveStylesheetUrl(url)` swaps the manifest's stylesheet URL for one of the
  application's own, e.g. a server endpoint that fetches the hashed file, scopes it once and
  caches it. The loader fetches whatever URL comes back.

The element is keyed on the fetched URL, so re-mounts reuse it and a new build gets a fresh one.

## Serving the embed

The admin image builds and serves the bundle when `ADMIN_EMBED_MODULES` names the modules to
compile in (a module and everything it depends on — the build does not resolve dependencies):

```
ADMIN_EMBED_MODULES=newsletters,content-platform,host-media,templates,editor-ai-copilot,broadcasts
```

`/embed/manifest.json` is served `no-store`; everything else under `/embed/` is content-hashed
and immutable, with CORS open to any origin (the bundle is public code — credentials and data
live behind the API and Supabase).

## Building this package

```bash
node packages/admin-embed/scripts/build.mjs
```

The contract types and `EMBED_CONTRACT` are copied from `packages/admin/src/embed/` at build
time, never hand-written, so the published contract cannot drift from the one the admin
implements. The output is a single self-contained ES module plus declarations.
