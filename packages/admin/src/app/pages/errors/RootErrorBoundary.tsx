// Import Depndencies
import { isRouteErrorResponse, useRouteError } from "react-router";
import { lazy, useEffect } from "react";

// Local Imports
import { Loadable } from "@/components/shared/Loadable";
import { isChunkLoadError } from "@/utils/isChunkLoadError";

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
      console.error("[RootErrorBoundary]", error);
      if (error instanceof Error && error.stack) {
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

  // A stale-chunk failure means a new version was deployed while this tab
  // was open — the requested code-split chunk no longer exists on the
  // server. This isn't a crash; a reload fetches the fresh index.html and
  // chunks. Show a friendly "please refresh" screen instead of the scary
  // generic error below.
  if (isChunkLoadError(error)) {
    return (
      <div className="flex h-screen w-screen items-center justify-center p-6">
        <div className="mx-auto max-w-md text-center space-y-4">
          <h1 className="text-lg font-semibold">A new version is available</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The app was updated while this tab was open. Reload to get the
            latest version.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            Reload page
          </button>
        </div>
      </div>
    );
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
