// Import Depndencies
import { isRouteErrorResponse, useRouteError } from "react-router";
import { lazy, useEffect } from "react";

// Local Imports
import { Loadable } from "@/components/shared/Loadable";

// ----------------------------------------------------------------------

const app = {
  401: lazy(() => import("./401")),
  404: lazy(() => import("./404")),
  429: lazy(() => import("./429")),
  500: lazy(() => import("./500")),
};

function RootErrorBoundary() {
  const error = useRouteError();

  // React Router swallows lazy-import failures and renders the boundary
  // without logging — users then see "client-side exception" with nothing in
  // the console. Log it ourselves so the underlying cause is visible.
  useEffect(() => {
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[RootErrorBoundary]", error);
      if (error instanceof Error && error.stack) {
        // eslint-disable-next-line no-console
        console.error("[RootErrorBoundary] stack:", error.stack);
      }
    }
  }, [error]);

  if (
    isRouteErrorResponse(error) &&
    Object.keys(app).includes(error.status.toString())
  ) {
    const Component = Loadable(app[error.status as keyof typeof app]);
    return <Component />;
  }

  const message = (error as any)?.message || (typeof error === "string" ? error : null);

  return (
    <div className="flex h-screen w-screen items-center justify-center p-6">
      <div className="mx-auto max-w-2xl text-center space-y-3">
        <div>
          Application error: a client-side exception has occurred while loading
          (see the browser console for more information).
        </div>
        {message && (
          <pre className="text-xs text-left whitespace-pre-wrap bg-gray-100 dark:bg-gray-800 rounded p-3 font-mono">
            {message}
          </pre>
        )}
      </div>
    </div>
  );
}

export default RootErrorBoundary;
