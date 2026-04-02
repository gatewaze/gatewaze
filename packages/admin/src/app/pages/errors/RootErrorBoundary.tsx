// Import Depndencies
import { isRouteErrorResponse, useRouteError } from "react-router";
import { lazy } from "react";

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

  if (
    isRouteErrorResponse(error) &&
    Object.keys(app).includes(error.status.toString())
  ) {
    const Component = Loadable(app[error.status as keyof typeof app]);
    return <Component />;
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="mx-auto max-w-xl text-center">
        Application error: a client-side exception has occurred while loading
        (see the browser console for more information).
      </div>
    </div>
  );
}

export default RootErrorBoundary;
