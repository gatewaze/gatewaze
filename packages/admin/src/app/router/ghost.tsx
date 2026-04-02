import { Navigate, RouteObject } from "react-router";
import GhostGuard from "@/middleware/GhostGuard";

/**
 * Ghost routes configuration
 * These routes are accessible only for non-authenticated users
 * Used for authentication pages like login, signup, etc.
 */
const ghostRoutes: RouteObject = {
  id: "ghost",
  Component: GhostGuard,
  children: [
    {
      path: "/",
      element: <Navigate to="/login" replace />,
    },
    {
      path: "login",
      lazy: async () => ({
        Component: (await import("@/app/pages/Auth")).default,
      }),
    },
    // Add additional ghost routes as needed
  ],
};

export { ghostRoutes };
