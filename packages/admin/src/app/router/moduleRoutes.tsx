/**
 * Generates React Router route objects from installed Gatewaze modules.
 *
 * Module admin routes are lazy-loaded and wrapped with FeatureGuard,
 * matching the pattern used by core routes in protected.tsx.
 *
 * Routes with guard: 'admin' are nested under /admin, others are top-level.
 */

import { RouteObject } from 'react-router';
// Build-time module list — may be empty in Docker.  Route components require
// bundled code, so this must remain a build-time import.  When empty, the
// exported route arrays are simply empty (graceful degradation).
import modules from 'virtual:gatewaze-modules';
import { FeatureGuard } from '@/middleware/FeatureGuard';

function buildRouteObject(route: {
  path: string;
  component: () => Promise<{ default: React.ComponentType }>;
  requiredFeature?: string;
}): RouteObject {
  const path = route.path.replace(/^\//, '');
  const segments = path.split('/');

  if (segments.length === 1) {
    return {
      path: segments[0],
      lazy: async () => {
        const component = await route.component();
        return {
          Component: () => (
            <FeatureGuard feature={route.requiredFeature}>
              <component.default />
            </FeatureGuard>
          ),
        };
      },
    };
  }

  // Nested: first segment is the parent, rest is the child path
  return {
    path: segments[0],
    children: [
      {
        path: segments.slice(1).join('/'),
        lazy: async () => {
          const component = await route.component();
          return {
            Component: () => (
              <FeatureGuard feature={route.requiredFeature}>
                  <component.default />
              </FeatureGuard>
            ),
          };
        },
      },
    ],
  };
}

function collectRoutes(guardFilter: string | undefined): RouteObject[] {
  const topLevel = new Map<string, RouteObject>();
  // nav↔route invariant #2 (spec §5.3): two DIFFERENT modules must not resolve
  // to the same composed route. Warn (never throw at runtime — a throw would
  // break the whole admin; `enforce` is a CI concern). Reserved wins is handled
  // upstream by composition; here we surface any residual collision loudly.
  const claimedBy = new Map<string, string>();

  for (const mod of modules) {
    if (!mod.adminRoutes) continue;

    // Build-time route namespace (spec-module-namespacing §5). Unreserved
    // (non-first-party) modules are composed under `/m/<qualifiedId>` when
    // ROUTE_COMPOSER_MODE=namespaced-new; first-party keep their vanity paths.
    // routeBase is '' in the default `vanity-all` mode → no change.
    const routeBase = (mod as { __identity?: { routeBase?: string } }).__identity?.routeBase ?? '';

    for (const route of mod.adminRoutes) {
      const guard = (route as { guard?: string }).guard;
      const effectiveGuard = guard === 'none' ? undefined : guard;
      if (effectiveGuard !== guardFilter) continue;

      // Only top-level (non-admin) routes are namespaced; guard:'admin' routes
      // keep nesting under /admin as before.
      const composed = routeBase && effectiveGuard !== 'admin'
        ? { ...route, path: `${routeBase}/${route.path.replace(/^\//, '')}` }
        : route;

      // Invariant #2: flag cross-module collisions on the same composed path.
      const fullPath = composed.path.replace(/^\//, '');
      const priorOwner = claimedBy.get(fullPath);
      const modId = (mod as { id?: string }).id ?? '(unknown)';
      if (priorOwner && priorOwner !== modId) {
         
        console.warn(
          `[modules] ROUTE_COLLISION: "${fullPath}" is claimed by both "${priorOwner}" and "${modId}". ` +
          `Namespace one of them (spec-module-namespacing §5). Rendering the first-registered.`,
        );
      } else {
        claimedBy.set(fullPath, modId);
      }

      const routeObj = buildRouteObject(composed as any);
      const topPath = routeObj.path!;

      // Merge children if we already have a route for this top-level path
      const existing = topLevel.get(topPath);
      if (existing) {
        // If the new route has children, merge them in
        if (routeObj.children) {
          existing.children = [
            ...(existing.children ?? []),
            ...routeObj.children,
          ];
        }
        // If the new route has a lazy loader but no children, it's an index route
        if (routeObj.lazy && !routeObj.children) {
          existing.children = [
            ...(existing.children ?? []),
            { index: true, lazy: routeObj.lazy },
          ];
        }
        // If the existing route had lazy (was first registered as a single-segment
        // path), convert it to an index child so the parent becomes a pathless
        // wrapper instead of a layout that swallows child renders.
        if (existing.lazy) {
          existing.children = [
            { index: true, lazy: existing.lazy },
            ...(existing.children ?? []),
          ];
          delete existing.lazy;
        }
      } else {
        topLevel.set(topPath, routeObj);
      }
    }
  }

  return [...topLevel.values()];
}

/** Top-level routes (no guard or guard !== 'admin') */
export const moduleRoutes = collectRoutes(undefined);

/** Routes that belong under /admin (guard: 'admin') */
export const moduleAdminRoutes = collectRoutes('admin');
