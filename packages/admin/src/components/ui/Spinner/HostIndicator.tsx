import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

/**
 * Mounts a fresh element from the host's loadingIndicator factory
 * (GwHostContext.loadingIndicator) into a box the caller sizes. A factory
 * that throws or returns something other than an element shows `fallback`
 * instead, so a host bug never leaves the pane blank. Decorative: the caller
 * owns the role="status" region and its label.
 */
export function HostIndicator({
  factory,
  fallback,
  className,
}: {
  factory: () => HTMLElement;
  fallback: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    let node: unknown;
    try {
      node = factory();
    } catch (err) {
      console.warn("[gw-embed] loadingIndicator threw; using the default spinner", err);
      setFailed(true);
      return;
    }
    if (!(node instanceof HTMLElement)) {
      console.warn("[gw-embed] loadingIndicator did not return an HTMLElement; using the default spinner");
      setFailed(true);
      return;
    }
    box.replaceChildren(node);
    return () => {
      box.replaceChildren();
    };
  }, [factory]);

  if (failed) return <>{fallback}</>;
  return <span ref={ref} className={clsx("inline-flex items-center justify-center", className)} aria-hidden="true" />;
}
