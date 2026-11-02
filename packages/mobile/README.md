# @gatewaze/mobile

The Gatewaze mobile app core: a module-free native shell (Expo / React
Native) that becomes a specific app — e.g. a health app — when built with
module sources configured. Spec: `gatewaze-roadmap/specs/spec-mobile-app.md`.

## How it composes

Modules ship a `mobile/` directory in their own repo (manifest + native
screens + typed API slice). `scripts/generate-mobile-registry.ts` discovers
them from `gatewaze.config.ts` `moduleSources` plus
`MOBILE_MODULE_SOURCES`, audits their import graph against
`scripts/dep-allowlist.json`, and emits `src/generated/` (git-ignored).
With no sources configured the shell still builds, with an empty registry.

See `docs/module-contributions.md` for the module-author contract.

## What the core provides

- Auth: Supabase email one-time-code sign-in, encrypted session storage,
  401-refresh-retry, sign-out and account-deletion hosting.
- The offline outbox + read-through cache (sqlite), typed failure taxonomy,
  and the `useCachedQuery` stale-while-revalidate helper.
- Runtime entitlement: per-member module visibility from each module's
  `available` probe, persisted last-known-good for offline launches.
- The component kit and the capability kit (camera surface + overlays,
  barcode scanner prefab, image picking) — see `src/index.ts`, imported by
  module code as `@gatewaze/mobile`.
- The tab host, module screen router (`/m/[module]/[screen]`), Settings
  (module sections, sync status with retry/discard, diagnostics, delete).

## Developing

```bash
# from the repo root
pnpm install
cd packages/mobile
cp .env.example .env   # fill in a brand's values + module sources
pnpm dev               # regenerates the registry, starts Expo
pnpm typecheck         # regenerates + tsc
pnpm lint
```

Building for devices uses EAS (`eas.json`): `development` (dev client),
`preview` (TestFlight / internal track), `production` (store, phase 2).
