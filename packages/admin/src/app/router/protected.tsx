import { RouteObject } from "react-router";

import AuthGuard from "@/middleware/AuthGuard";
import AdminGuard from "@/middleware/AdminGuard";
import { FeatureGuard } from "@/middleware/FeatureGuard";
import { OnboardingGuard } from "@/middleware/OnboardingGuard";
import { UnauthorizedPage } from "@/components/guards/FeatureGuard";
import { DynamicLayout } from "../layouts/DynamicLayout";
import { RoleBasedRedirect } from "./RoleBasedRedirect";
import { moduleRoutes, moduleAdminRoutes } from "./moduleRoutes";

/**
 * Core routes that are NOT provided by modules.
 * Module-specific routes (competitions, discounts, offers, cohorts, etc.)
 * are now declared in each module's index.ts and loaded via moduleRoutes.
 */
const coreChildren = [
  {
    path: "home",
    lazy: async () => {
      const module = await import("@/app/pages/home");
      return {
        Component: () => (
          <FeatureGuard feature="dashboard_home">
            <module.default />
          </FeatureGuard>
        ),
      };
    },
  },
  {
    path: "people",
    children: [
      {
        index: true,
        lazy: async () => {
          const module = await import("@/app/pages/people");
          return {
            Component: () => (
              <FeatureGuard feature="dashboard_people">
                <module.default />
              </FeatureGuard>
            ),
          };
        },
      },
      {
        path: ":id",
        lazy: async () => {
          const module = await import("@/app/pages/people/detail");
          return {
            Component: () => (
              <FeatureGuard feature="dashboard_people">
                <module.default />
              </FeatureGuard>
            ),
          };
        },
      },
      {
        path: ":id/:tab",
        lazy: async () => {
          const module = await import("@/app/pages/people/detail");
          return {
            Component: () => (
              <FeatureGuard feature="dashboard_people">
                <module.default />
              </FeatureGuard>
            ),
          };
        },
      },
    ],
  },
  {
    path: "events",
    children: [
      {
        index: true,
        lazy: async () => {
          const module = await import("@/app/pages/events");
          return {
            Component: () => (
              <FeatureGuard feature="events">
                <module.default />
              </FeatureGuard>
            ),
          };
        },
      },
      {
        path: ":eventId",
        lazy: async () => {
          const module = await import("@/app/pages/events/detail");
          return {
            Component: () => (
              <FeatureGuard feature="events">
                <module.default />
              </FeatureGuard>
            ),
          };
        },
      },
      {
        path: ":eventId/:tab",
        lazy: async () => {
          const module = await import("@/app/pages/events/detail");
          return {
            Component: () => (
              <FeatureGuard feature="events">
                <module.default />
              </FeatureGuard>
            ),
          };
        },
      },
    ],
  },
];

/**
 * Protected routes configuration
 * These routes require authentication to access
 * Uses AuthGuard middleware to verify user authentication
 */
const protectedRoutes: RouteObject = {
  id: "protected",
  Component: AuthGuard,
  children: [
    // OnboardingGuard redirects temp setup admin to /onboarding
    {
      Component: OnboardingGuard,
      children: [
    // The dynamic layout supports both the main layout and the sideblock.
    {
      Component: DynamicLayout,
      children: [
        {
          index: true,
          Component: RoleBasedRedirect,
        },
        // Core routes (home, people, events)
        ...coreChildren,
        // Module-provided routes (from gatewaze.config.ts modules)
        ...moduleRoutes,
        // Admin-only routes
        {
          path: "admin",
          Component: AdminGuard,
          children: [
            {
              path: "users",
              lazy: async () => {
                const module = await import("@/app/pages/admin/users");
                return {
                  Component: () => (
                    <FeatureGuard feature="users">
                      <module.default />
                    </FeatureGuard>
                  ),
                };
              },
            },
            {
              path: "settings",
              lazy: async () => {
                const module = await import("@/app/pages/settings/sections/Branding");
                return {
                  Component: () => (
                    <FeatureGuard feature="settings">
                      <module.default />
                    </FeatureGuard>
                  ),
                };
              },
            },
            {
              path: "emails",
              lazy: async () => {
                const module = await import("@/app/pages/admin/emails");
                return {
                  Component: () => (
                    <FeatureGuard feature="emails">
                      <module.default />
                    </FeatureGuard>
                  ),
                };
              },
            },
            {
              path: "modules",
              lazy: async () => {
                const module = await import("@/app/pages/admin/modules");
                return {
                  Component: () => (
                    <FeatureGuard feature="settings">
                      <module.default />
                    </FeatureGuard>
                  ),
                };
              },
            },
            // Module-provided admin routes (guard: 'admin')
            ...moduleAdminRoutes,
          ],
        },
      ],
    },
    // Unauthorized page - shown when user doesn't have permission
    {
      path: "unauthorized",
      Component: UnauthorizedPage,
    },
      ],
    },
  ],
};

export { protectedRoutes };
