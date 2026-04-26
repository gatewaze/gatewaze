// Import Dependencies
import { createBrowserRouter, RouteObject } from "react-router";

// Local Imports
import Root from "@/app/layouts/Root";
import RootErrorBoundary from "@/app/pages/errors/RootErrorBoundary";
import { SplashScreen } from "@/components/template/SplashScreen";
import { SetupGuard } from "@/middleware/SetupGuard";
import { protectedRoutes } from "./protected";
import { ghostRoutes } from "./ghost";
import { publicRoutes } from "./public";

/**
 * Main application router configuration
 * Combines protected, ghost, and public routes under a common root
 */
const router = createBrowserRouter([
  {
    id: "root",
    Component: Root,
    hydrateFallbackElement: <SplashScreen />,
    ErrorBoundary: RootErrorBoundary,
    children: [
      // Setup & onboarding routes — outside all guards
      {
        path: "setup",
        lazy: async () => ({
          Component: (await import("@/app/pages/setup/SetupPage")).SetupPage,
        }),
      },
      // Public developer docs — accessible without authentication
      {
        path: "docs",
        lazy: async () => ({
          Component: (await import("@/app/pages/docs/DocsPage")).DocsPage,
        }),
      },
      {
        path: "onboarding",
        lazy: async () => ({
          Component: (await import("@/app/pages/onboarding/OnboardingStepGuard")).default,
        }),
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import("@/app/pages/onboarding/OnboardingPage")).OnboardingPage,
            }),
          },
          {
            path: "modules",
            lazy: async () => ({
              Component: (await import("@/app/pages/onboarding/ModuleSelectionStep")).default,
            }),
          },
          {
            path: "setup",
            lazy: async () => ({
              Component: (await import("@/app/pages/onboarding/ModuleSetupStep")).default,
            }),
          },
          {
            path: "theme",
            lazy: async () => ({
              Component: (await import("@/app/pages/onboarding/ThemeSetupStep")).default,
            }),
          },
        ],
      },
      // SetupGuard wraps normal app routes — redirects to /setup if needed
      {
        Component: SetupGuard,
        children: [protectedRoutes, ghostRoutes, publicRoutes] as RouteObject[],
      },
    ],
  },
]);

export default router;
