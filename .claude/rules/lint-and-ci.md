---
# Universal rule — always applied (no `paths:` scope).
source: gatewaze-skills/production-readiness/references/lint-and-ci.md
---

# Lint and CI

## Per-package lint configuration

| Package | Linter | Config | Plugins |
|---------|--------|--------|---------|
| admin | eslint v9 flat config | `packages/admin/eslint.config.js` | `js.configs.recommended`, `tseslint.configs.recommended`, `react-hooks`, `react-refresh` |
| api | eslint v9 flat config | `packages/api/eslint.config.js` | `js.configs.recommended`, `tseslint.configs.recommended` (no React plugins — server-side only) |
| portal | `next lint` | discovers root `.eslintrc.cjs` | `@typescript-eslint`, `react-hooks` (loaded via root) |
| shared | no-op echo | `"lint": "echo 'no lint configured'"` | — |

`pnpm -r lint` must exit 0. If you change a lint script, run it
locally and check the exit code.

## Root `.eslintrc.cjs`

Used only by portal's `next lint` (which auto-discovers parent
configs):

```js
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    // 'prettier' was here but eslint-config-prettier isn't installed —
    // dropping it lets `next lint` actually run.
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  ignorePatterns: ['dist', 'node_modules', '.next'],
};
```

**Don't:**
- Add `'prettier'` to extends — eslint-config-prettier isn't installed
  and it'll break `next lint` at config-load time.
- Add `varsIgnorePattern` without keeping `argsIgnorePattern` — both
  are needed for the canonical destructure-and-strip pattern (`const {
  trackingHead: _, ...rest } = brandConfig`).

## Admin flat config

`packages/admin/eslint.config.js`. Browser globals + react plugins.
`@typescript-eslint/no-explicit-any` is `'off'` here intentionally —
admin has 34 polymorphic-erasure UI components where narrowing breaks
JSX inference. See `references/typescript-patterns.md`.

## API flat config

`packages/api/eslint.config.js`. Node globals only, no react plugins.
Pinned versions match admin's: eslint `^9.33.0`, typescript-eslint
`^8.39.1`. The lint script is `eslint src/`.

## CI pipeline (`.github/workflows/pr.yml`)

Required-to-merge gates:

- **typecheck** — runs `pnpm --filter @gatewaze/<pkg> typecheck` for
  all four packages. Admin and portal are now blocking (the
  `continue-on-error: true` was removed once phase-4 cleanup landed).
  If a typecheck regression appears, reintroducing `continue-on-error:
  true` is a one-line revert.
- **lint** — runs `pnpm -r lint` across the workspace. Every package's
  lint script must exit 0.
- **test** — `pnpm --filter @gatewaze/<pkg> test` for api, shared,
  portal. Admin tests run separately because they need jsdom setup.
- **shell-safety** — `pnpm exec tsx scripts/audit-shell-calls.ts`.
  Forbids any `child_process.exec`, `execSync` with single string,
  or `spawn { shell: true }` outside of `packages/api/src/lib/safe-exec.ts`.
- **audit** — `pnpm audit --prod --audit-level=high`. Currently 2
  high (lodash `_.template` advisories with no upstream patch — see
  below).
- **pgtap** — `supabase test db` against a temporary Supabase
  instance. Tests RLS policies.
- **e2e** — Playwright. Promoted from non-blocking to blocking once
  the multi-tenant fixtures stabilised; reverting to
  `continue-on-error: true` is the canonical operator action if E2E
  flakes appear in the first week.

## pnpm overrides (root `package.json`)

```json
"pnpm": {
  "overrides": {
    "undici@>=7.0.0 <7.24.0": "^7.24.0",
    "fast-xml-parser@>=5.0.0 <5.5.6": "^5.5.6",
    "flatted@<=3.4.1": "^3.4.2",
    "picomatch@>=4.0.0 <4.0.4": "^4.0.4",
    "path-to-regexp@<0.1.13": "^0.1.13",
    "highlight.js@<10.4.1": "^11.10.0"
  }
}
```

Each entry forces a patched range for a transitive vuln where the
intermediate package hasn't bumped its pin yet. Don't remove these
without re-running `pnpm audit`.

## The two unfixable lodash advisories

```
lodash      <=4.17.23  →  patched: >=4.18.0  (doesn't exist on npm)
lodash-es   <=4.17.23  →  patched: >=4.18.0  (doesn't exist on npm)
```

Both advisories are about `_.template` with attacker-controlled key
names. We grep'd the repo and there are zero `_.template` call sites,
so the practical risk is nil. Don't try to "fix" them — there's
nothing to upgrade to. Migrating off lodash is a deeper refactor and
isn't in scope.

## husky / lint-staged

`.husky/pre-commit` runs `pnpm exec lint-staged`. The lint-staged
config is in root `package.json`:

```json
"lint-staged": {
  "packages/admin/src/**/*.{ts,tsx}": [
    "pnpm --filter @gatewaze/admin exec eslint --fix"
  ],
  "packages/api/src/**/*.{ts,tsx}": [
    "pnpm --filter @gatewaze/api exec eslint --fix"
  ]
}
```

**Don't:**
- Add a hook for a package without eslint installed — it'll fail with
  ENOENT and block every commit. The portal's `next lint` is broken
  in lint-staged mode (deprecation warnings and dependency issues), so
  portal isn't in the hook config.
- Bypass with `--no-verify`. If a hook fails, fix the issue. If you
  must bypass for a specific reason, get explicit user authorisation.

## Build verification

All four packages must build cleanly:

```bash
pnpm --filter @gatewaze/shared build  # tsc -b
pnpm --filter @gatewaze/api build     # tsc -p tsconfig.build.json
pnpm --filter @gatewaze/admin build   # vite build
pnpm --filter @gatewaze/portal build  # next build
```

The portal `next build` passes the typecheck-during-build gate
because `next.config.ts` has `typescript.ignoreBuildErrors: true` —
that's a deliberate dev-experience choice (TS errors surface during
`pnpm typecheck` instead of blocking the build). Don't flip it without
weighing the cost: a broken TS state would silently ship.

## Common breakage shapes

| Symptom | Likely cause |
|---|---|
| `Command "eslint" not found` in lint-staged | Hook references a package without eslint installed |
| `Failed to load config "prettier"` | eslint-config-prettier isn't installed; remove from `extends` |
| `Definition for rule '<plugin>' was not found` | Plugin isn't in `plugins` array of eslint config |
| `File ... is not under 'rootDir'` | tsconfig `rootDir` too narrow; should be `../..` for cross-package imports |
| 248 TS errors on portal locally vs 75 in CI | Generated module registry has local-FS paths instead of Docker symlinks; see `references/module-registry.md` |
