# @gatewaze/admin-embed

The Gatewaze admin module set, built as a library so a host application can mount it into one of
its own DOM nodes — no iframe.

```ts
import { mount } from '@gatewaze/admin-embed';

const handle = mount(element, {
  basename: '/foundation/gw',
  supabase: { url, anonKey },
  apiBaseUrl: '', // '' means same-origin /api/gw
  enabled: { moduleIds: [...], features: [...] },
  signIn: { lfidStartUrl, returnUrl },
  portalContainer: portalsElement, // where Radix overlays render
  notify: (n) => hostToast(n), // optional: render our toasts as yours
});

handle.unmount();
```

`mount()` never throws; every failure path reports through `ctx.onFatal` and returns a safe handle.
One live mount per page.

## Stylesheet

The CSS is shipped separately as `@gatewaze/admin-embed/admin.css` and is **not** imported by the
entry — a host that renders us inside its own chrome needs to scope our styles before serving them,
which it cannot do if the bundle pulls them in. Load it yourself, ideally after passing it through
whatever containment your host needs.

## Building

Assembled from `packages/admin`'s library build:

```bash
pnpm --filter @gatewaze/admin exec vite build -c vite.embed.config.ts
node packages/admin-embed/scripts/build.mjs
```

Type declarations are copied from `packages/admin/src/embed/types.ts`, never hand-written, so the
published contract cannot drift from the one the embed implements.
