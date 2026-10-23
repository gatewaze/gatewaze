import { lazy, useEffect, useMemo } from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';

import { AuthProvider } from '@/app/contexts/auth/Provider';
import { BreakpointProvider } from '@/app/contexts/breakpoint/Provider';
import { SidebarProvider } from '@/app/contexts/sidebar/Provider';
import { ThemeProvider } from '@/app/contexts/theme/Provider';
import { RadixThemeBridge } from '@/app/contexts/theme/RadixThemeBridge';
import { moduleAdminRoutes, moduleBareRoutes, moduleRoutes } from '@/app/router/moduleRoutes';

import { Loadable } from '@/components/shared/Loadable';
import { PageLoadingSpinner } from '@/components/ui/Spinner/PageLoadingSpinner';

import { EmbedErrorBoundary } from './EmbedErrorBoundary';
import { EmbedModulesProvider } from './EmbedModulesProvider';
import { useFirstPaintSignal } from './firstPaint';
import type { GwHostContext } from './types';

/**
 * The standalone app mounts these once in the Root layout (app/layouts/Root.tsx), which the embed
 * deliberately does not use — Root also owns a splash screen, scroll restoration and a progress
 * bar, all of which belong to the host in an embed.
 *
 * Their absence was not cosmetic: `toast()` calls throughout the modules resolve against whichever
 * sonner Toaster is mounted, so with none mounted every toast was silently dropped. The
 * copy-to-clipboard confirmations on the Substack and Beehiiv actions are the visible case — the
 * copy itself worked, the feedback never appeared. Tooltip is the same story for `[data-tooltip]`
 * anchors.
 *
 * Both render inline (no portal of their own), so they land inside the mount element and the
 * contained stylesheet reaches them without further help.
 */
const Toaster = Loadable(lazy(() => import('@/components/template/Toaster')));
const Tooltip = Loadable(lazy(() => import('@/components/template/Tooltip')));

/**
 * Navigation contract (spec): the embed router owns pushState/popstate
 * inside the basename; a path that doesn't match any compiled module
 * route is handed to the host instead of rendering a blank/404 React
 * view, so an escaped navigation can never strand the user.
 */
function CatchAllHandoff({ navigateHost }: { navigateHost?: (path: string) => void }) {
  useEffect(() => {
    const path = window.location.pathname + window.location.search + window.location.hash;
    if (navigateHost) {
      navigateHost(path);
    } else {
      window.location.assign(path);
    }
  }, [navigateHost]);
  return null;
}

/**
 * Every module route is lazy, so until the matched route's code has loaded the
 * router has nothing to render. Without a HydrateFallback that was nothing at
 * all: a blank pane between the host's own skeleton and the page's spinner.
 * This draws the same spinner FeatureGuard draws next, in the same place, and
 * counts as the embed's first paint.
 */
function EmbedRouteFallback() {
  useFirstPaintSignal();
  return <PageLoadingSpinner />;
}

/**
 * Pathless root around the module routes: renders the matched route and, when
 * no fallback was ever needed (the route's code was already loaded), signals
 * first paint itself.
 */
function EmbedRootLayout() {
  useFirstPaintSignal();
  return <Outlet />;
}

export function EmbedApp({ ctx, container }: { ctx: GwHostContext; container: HTMLElement }) {
  const router = useMemo(
    () =>
      createBrowserRouter(
        [
          {
            Component: EmbedRootLayout,
            HydrateFallback: EmbedRouteFallback,
            children: [
              ...moduleRoutes,
              ...moduleBareRoutes,
              { path: 'admin', children: moduleAdminRoutes },
              { path: '*', element: <CatchAllHandoff navigateHost={ctx.navigateHost} /> },
            ],
          },
        ],
        {
          basename: ctx.basename,
        },
      ),
    // Rebuilding the router on navigateHost/basename change is intentional
    // and rare (both come from the host and are effectively static for the
    // life of a mount) — the module route table itself is build-time fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.basename],
  );

  return (
    <EmbedErrorBoundary onFatal={ctx.onFatal}>
      <AuthProvider>
        <EmbedModulesProvider overlay={ctx.enabled}>
          <ThemeProvider container={container}>
            <RadixThemeBridge>
              <BreakpointProvider container={container}>
                <SidebarProvider container={container}>
                  <RouterProvider router={router} />
                  <Tooltip />
                  <Toaster />
                </SidebarProvider>
              </BreakpointProvider>
            </RadixThemeBridge>
          </ThemeProvider>
        </EmbedModulesProvider>
      </AuthProvider>
    </EmbedErrorBoundary>
  );
}
