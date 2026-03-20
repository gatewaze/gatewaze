/**
 * Generates React Router route objects from installed Gatewaze modules.
 *
 * Module admin routes are lazy-loaded and wrapped with FeatureGuard,
 * matching the pattern used by core routes in protected.tsx.
 *
 * Routes with guard: 'admin' are nested under /admin, others are top-level.
 */

import { RouteObject } from 'react-router';
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
              {/* @ts-expect-error -- module component typing */}
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
                {/* @ts-expect-error -- module component typing */}
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

  for (const mod of modules) {
    if (!mod.adminRoutes) continue;

    for (const route of mod.adminRoutes) {
      const guard = (route as { guard?: string }).guard;
      const effectiveGuard = guard === 'none' ? undefined : guard;
      if (effectiveGuard !== guardFilter) continue;

      const routeObj = buildRouteObject(route);
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
