// Import Dependencies
import { ComponentType, Suspense, LazyExoticComponent } from "react";

// ----------------------------------------------------------------------

function Loadable<T extends object>(
  Component: LazyExoticComponent<ComponentType<T>>,
  Fallback?: ComponentType
) {
  return function LoadableComponent(props: T) {
    return (
      <Suspense fallback={Fallback ? <Fallback /> : null}>
        <Component {...props} />
      </Suspense>
    );
  };
}

export { Loadable };
