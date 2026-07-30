---
paths: ["packages/admin/**/*.tsx", "packages/portal/**/*.tsx"]
source: gatewaze-skills/production-readiness/references/react-patterns.md
---

# React patterns

## Rules of hooks — guards go BELOW hook calls

The single biggest latent crash class we cleared. Two real bugs were
fixed during the prod-hardening pass; both had the same shape:

```tsx
// BUG — useMemo / useState / useDidUpdate run conditionally
export function Sidebar() {
  const { permissions, isLoading } = useFeaturePermissions();
  const { ready: modulesReady } = useModulesContext();

  if (isLoading || !modulesReady) {
    return null;  // ← early return BEFORE hook calls
  }

  const filteredNavigation = useMemo(...)  // ← hook is conditional
  const [activeSegmentPath, setActiveSegmentPath] = useState(...)
  // ... more hooks ...
}
```

When `isLoading` or `modulesReady` flips during a re-render, React's
hook bookkeeping mismatches and the next render crashes.

**Fix — guard below hooks:**
```tsx
export function Sidebar() {
  const { permissions, isLoading } = useFeaturePermissions();
  const { ready: modulesReady } = useModulesContext();

  // All hooks run unconditionally
  const filteredNavigation = useMemo(...)
  const [activeSegmentPath, setActiveSegmentPath] = useState(...)
  useDidUpdate(...)
  useDidUpdate(...)

  if (isLoading || !modulesReady) {
    return null;
  }

  return (...);
}
```

Or move the guard inside the memo body if computing the value is the
expensive part:
```tsx
const featured = useMemo(() => {
  if (!categories || categories.length === 0) return null;
  // ... compute ...
}, [events, categories, userLocation]);

if (!featured) return null;
```

**Existing fixes:**
- `packages/admin/src/app/layouts/MainLayout/Sidebar/index.tsx`
- `packages/portal/components/timeline/FeaturedContent.tsx`

`react-hooks/rules-of-hooks` is set to `error` in both the root
.eslintrc.cjs and admin's flat config — CI will catch this. But
catching it post-hoc is more painful than not writing it.

## Fast refresh — component-only files

`react-refresh/only-export-components` fires when a `'use client'`
file (or any file participating in fast refresh) mixes a component
export with a non-component export. Every change forces a full module
reload instead of patching the running tree.

**Patterns we extracted during the cleanup:**

| Original location | Non-component thing | New location |
|---|---|---|
| `auth/Provider.tsx` | `export { useAuthContext as useAuth } from './context'` | Removed — three importers repointed at `./context` directly |
| `settings/sections/StorageSettings.tsx` | `validateStorageBucketUrl()` | `./storage-bucket-validation.ts` |
| `components/ModuleSlot.tsx` | `useHasSlot()` | `hooks/useHasSlot.ts` |
| `components/guards/FeatureGuard.tsx` | `useFeatureGuard()` | `hooks/useFeatureGuard.ts` (barrel re-exports it) |
| `components/shared/branding/GradientWaveEditor.tsx` | `DEFAULT_GRADIENT_WAVE_CONFIG`, `GradientWaveConfig` interface | `./gradient-wave-config.ts` |
| `docs-entry/main.tsx` | `DocsApp`, `McpDocs`, `ToolList` | `./DocsApp.tsx` (entry now mount-only) |

**Allowed in component files:**
- `export type { ... }` (type-only, react-refresh ignores)
- `export interface ... {}` (type-only)

**Not allowed:**
- `export function helperFn() {}` (value, non-component)
- `export const SOME_CONSTANT = ...` (value, non-component)
- `export { something } from './other'` (re-export of value)
- `export function useSomething() {}` (hook — it's a function value)

For a hook that's tightly coupled to a component (e.g. they share types
defined in the component file), still extract — the component file
can `import type { X } from './sibling-types'` to keep the type local.

## `Image` shadowing

`packages/portal/components/event/PhotoGrid.tsx` had:
```tsx
import Image from 'next/image';
// ...
const img = new Image();  // ← TS error: Image is the React component, not the DOM constructor
```

**Fix:**
```tsx
const img = new window.Image();
```

This pattern recurs anywhere `next/image` is imported as `Image`. Also
applies to any similar shadowing — `URL`, `Request`, `Response`,
`Headers` if you import a custom one.

## `react-hooks/exhaustive-deps`

Set to `warn`. The current count is 17 (admin) + 10 (portal) and they
need per-instance browser-verified review.

**Don't bulk-fix.** Adding missing deps blindly can cause:
- Infinite loops (effect that updates state included in deps)
- Performance regressions (memoised function recreated on every render)
- Behaviour changes (effect now runs on every change instead of only
  on mount)

**Process for each warning:**
1. Read the effect body. What does it actually depend on?
2. If the missing dep is a stable function reference (a React-router
   `navigate`, a refetch helper from a custom hook), the warning is
   probably correct — adding the dep is safe. Verify in the browser.
3. If the missing dep is a state setter or callback the effect itself
   updates, adding it loops infinitely. Use `useEffect(() => { ... },
   [primary-trigger])` and add a comment explaining why other deps are
   intentionally omitted.
4. If the effect should genuinely run only once (mount-only behaviour),
   keep `[]` and add `// eslint-disable-next-line react-hooks/
   exhaustive-deps -- mount-only by design`.
5. Test in the browser with the dev server — both the trigger AND
   stress-test with the dep changing.

**Don't** silently add `// eslint-disable-next-line` to drop the
warning count. The warnings are signal.

## `next/image` vs `<img>`

The portal (Next.js) uses `next/image` everywhere — adding a raw `<img>`
will fail `pnpm --filter @gatewaze/portal lint` (next/next/no-img-
element). The admin (Vite) tolerates raw `<img>` — admin is internal-
only, no SEO/performance pressure for image optimisation.

When migrating an admin `<img>` to next-image equivalent (which the
codebase does in some places), check that `next.config.ts`'s
`images.remotePatterns` includes the source host.
