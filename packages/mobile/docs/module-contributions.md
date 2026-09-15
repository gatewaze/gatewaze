# Contributing mobile screens from a module

The core app (`packages/mobile`) is module-free. A module adds mobile UI by
shipping a `mobile/` directory in its own repo; the registry generator
discovers it from configured module sources and bakes it in at build time.

## Layout

```
modules/<id>/mobile/
  index.ts        — exports `mobileModule: GatewazeMobileModule` (see below)
  CONTRACT.md     — verified request/response shapes of every call this
                    module's screens make, extracted from the module's own
                    api/register-routes.ts, stamped with the commit hash
                    it was verified against
  api.ts          — the module's typed call slice, built on core primitives
  screens/…       — React Native screens
```

## Hard rules

1. **Native only.** Screens are React Native component trees. No DOM, no
   webviews, no web-only APIs.
2. **Every file starts with `// @ts-nocheck`** plus the comment
   `— resolved against the core app at build time` (the same convention as
   module portal pages). The core app's typecheck follows imports into
   module files; the pragma keeps cross-repo resolution out of its error
   budget. Type discipline inside the module comes from its own repo.
3. **Imports**: relative paths, `@gatewaze/mobile` (the core kit),
   `@gatewaze/shared` (types, `import type` only), `react`, `react-native`,
   `react-native-svg`, `react-native-safe-area-context`, `expo-router`,
   `@expo/vector-icons` — plus capability-gated packages (`expo-camera`,
   `expo-image-picker`) **only when the manifest declares the capability**.
   The generator audits the import graph and fails the build on anything
   else. Modules bring zero dependencies of their own.
4. **All data over the module's own API** via `ctx.apiFetch` /
   `useModuleContext()`. Never Supabase directly, never another module's
   internals. Pushing another module's screen by route
   (`router.push('/m/<module>/<screen>')`) is allowed — it is a URL, not an
   import.

## The manifest

```ts
// @ts-nocheck — resolved against the core app at build time
import type { GatewazeMobileModule } from '@gatewaze/shared';

export const mobileModule: GatewazeMobileModule = {
  id: 'health-diet',
  requiredCapabilities: ['barcode', 'camera'],
  // Drawer destinations. `section` groups them; entries without one group
  // under the app name.
  tabs: [{ id: 'food', label: 'Food', icon: 'silverware-fork-knife', order: 30,
           section: 'Health', screen: () => require('./screens/FoodTab') }],
  screens: [{ name: 'add-food', title: 'Add Food',
              screen: () => require('./screens/AddFood') }],
  settingsSections: [ /* optional Settings contributions */ ],
  deletionCopy: 'Your complete food log and saved meals.',
  available: async (ctx) => { /* module's own status probe; false = definitive no; THROW = transient */ },
  onSessionReady: async (ctx) => 'ready',   // optional bootstrap (see health-core)
  blockedScreen: () => require('./screens/Blocked'),  // with onSessionReady
  deleteAccount: async (ctx) => { /* family root module only: ONE server-side call */ },
  outboxKinds: {
    'health-fitness:workout_session': async (ctx, payload, clientRef) => { /* replay via typed call */ },
  },

  // ── Coach surface contributions (see below) ──
  composerModes: [{ id: 'scan', label: 'Scan', icon: 'barcode', order: 20,
                    surface: () => require('./modes/Scan') }],
  threadCards: { 'health-diet:food': () => require('./cards/FoodCard') },
  coachProvider: undefined,  // exactly one module in a build may declare this
};
```

## The coach surface

The app's home is a coach conversation owned by the CORE: the core renders
the thread, the bubbles and the composer. Modules supply three things.

**`coachProvider`** — the one module that drives the conversation
implements `threads`, `thread`, `createThread`, `send`, `generate` and
optionally `unread`. `generate` performs whatever request-and-poll dance
the module's API needs and resolves to the full updated message list. The
build fails if two modules declare it; with none, the app has no coach
surface and opens at the first enabled drawer entry.

Messages are mapped onto the core's shape: `{ id, role: 'member' |
'coach', text?, choices?, cards?, createdAt, pending? }`. `choices` become
tappable quick replies. `cards` are `{ kind, payload }` pairs.

**`threadCards`** — renderers keyed by card kind (namespace them
`'<module-id>:<kind>'`). The core dispatches each card in a message to the
registered renderer, so one thread can interleave a workout draft from one
module and a food card from another. A renderer receives `{ payload,
threadId }` and talks only to its own module's API. An unregistered kind
renders a plain fallback rather than crashing.

**`composerModes`** — entries in the composer's mode track (Photo, Scan,
Search). A mode's `surface` renders full-screen behind the composer and
receives `{ onDismiss, threadId }`. Call `onDismiss` when the member
finishes so they return to the thread. Modes are entitlement-filtered like
tabs, so a member without the diet module never sees its modes.

## Screen chrome

The core's drawer header shows the active destination's name, so a
destination screen must NOT repeat it as a heading. Start the content with
the first real section instead. Pushed screens get their title from the
router, so the same rule applies there. `Greeting` is for editorial
openings (the coach home's "How can I help?"), not for labelling a screen.

## Design system

The app is dark-first and native-first. Use `useTheme()` for the active
palette rather than the static `colors` export (which is dark-only and
exists for screens not yet migrated). Use the core `Icon` component rather
than importing an icon set: it renders SF Symbols on iOS and
MaterialCommunityIcons elsewhere. Use `GlassPanel` (or `Card`, which is
glass-backed) for surfaces rather than hand-rolled translucency: it uses
Liquid Glass on iOS 26+, blur below that, and a solid fill on Android.
Motion uses the shared easing token; anything ambient must honour Reduce
Motion.

Notes:
- `available` must resolve `false` for a definitive no (e.g. the status
  route says disabled, or a 403 because the member lacks the module).
  Throw only for genuinely transient failures — a throw keeps the
  last-known tab state.
- Manifest fields parsed by the generator (`id`, `requiredCapabilities`,
  `deletionCopy`) must be **literal** strings/arrays — the generator reads
  source, it never executes module code.

## The core kit (`@gatewaze/mobile`)

Components: `Screen` (safe-area + scroll + pull-to-refresh), `Card`, `Row`,
`Spacer`, `Title/Heading/Body/Label/Caption/Stat`, `Button`, `Input`,
`ListItem`, `Badge`, `ProgressBar`, `EmptyState`, `LoadingState`, `Ring`
(segmented progress ring), `DayStrip` (week/day selector).

Capabilities: `CameraSurface` (+ children as overlays — this is how a
module lays pose-framing guidance over the camera), `ScanFrame` (white
corner brackets), `CaptureButton`, `BarcodeScannerView` (prefab scanner,
EAN-8/13 + UPC-A/E), `pickFromLibrary`, `captureWithSystemCamera`,
`appendImage`.

Hooks/helpers: `useModuleContext()` (apiFetch, cacheGet/Set, enqueue,
store), `useCachedQuery(cacheKey, fetcher)` (stale-while-revalidate;
`refresh()` bypasses cache), `newClientRef()`, `isApiFailure`,
`useSession()`. Theme: `colors`, `spacing`, `radius`, `type` — including
`colors.series1/2/3` for metric triads.

`ctx.apiFetch(path, { method?, headers?, body? })`: prepends the API base
URL, attaches the bearer token, retries once on 401 after refresh, JSON in
and out (FormData bodies pass through), throws typed failures
(`kind: 'offline' | 'auth' | 'client' | 'server'`).

## Offline writes

Generate `newClientRef()` once per logical action, `ctx.enqueue(kind,
payload, clientRef)`, and implement the replay in `outboxKinds`. In the
handler, treat an idempotent-replay conflict (HTTP 409, or the route's
duplicate-detection response) as success. Throw `client`-kind failures for
permanent rejections (they surface in the user's Sync Status screen);
let `offline`/`server` failures propagate for automatic retry. Kinds are
namespaced `'<module-id>:<what>'`.

## Screens as route hosts

Tab screens receive no props. Pushable screens receive the query params of
`router.push('/m/<module>/<name>?id=…')` as string props.
