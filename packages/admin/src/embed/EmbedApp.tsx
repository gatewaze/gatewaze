import { useEffect, useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { AuthProvider } from '@/app/contexts/auth/Provider';
import { BreakpointProvider } from '@/app/contexts/breakpoint/Provider';
import { SidebarProvider } from '@/app/contexts/sidebar/Provider';
import { ThemeProvider } from '@/app/contexts/theme/Provider';
import { RadixThemeBridge } from '@/app/contexts/theme/RadixThemeBridge';
import { moduleAdminRoutes, moduleRoutes } from '@/app/router/moduleRoutes';

import { EmbedErrorBoundary } from './EmbedErrorBoundary';
import { EmbedModulesProvider } from './EmbedModulesProvider';
import type { GwHostContext } from './types';

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

export function EmbedApp({ ctx, container }: { ctx: GwHostContext; container: HTMLElement }) {
  const router = useMemo(
    () =>
      createBrowserRouter(
        [
          ...moduleRoutes,
          { path: 'admin', children: moduleAdminRoutes },
          { path: '*', element: <CatchAllHandoff navigateHost={ctx.navigateHost} /> },
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
                </SidebarProvider>
              </BreakpointProvider>
            </RadixThemeBridge>
          </ThemeProvider>
        </EmbedModulesProvider>
      </AuthProvider>
    </EmbedErrorBoundary>
  );
}
