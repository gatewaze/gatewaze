import { useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";

import { getHostLoadingIndicator } from "@/embed/hostLoadingIndicator";

export interface PageLoadingSpinnerProps {
  /** Replaces the default `py-16` box, for a page that centres its spinner differently. */
  className?: string;
  /** Visually hidden text announced to screen readers. */
  label?: string;
}

/**
 * The page-level loading spinner: a centred box with the brand-coloured ring the
 * module list pages have always drawn (`h-8 w-8 border-b-2` in accent-9, `py-16`
 * above and below).
 *
 * Shared so that every loading state on the way into a page looks the same: the
 * embed's route fallback, FeatureGuard's permission check and the page's own
 * data load. Each one replaces the last in the same place, so the hand-over
 * reads as one spinner rather than a blank pane followed by a jump.
 *
 * Embedded with GwHostContext.loadingIndicator, the host's own spinner element
 * is mounted in place of the ring, inside the same box, so the embed's
 * loading states look like the host's. Standalone, or without the option, the
 * ring renders as before.
 */
export function PageLoadingSpinner({ className, label = "Loading" }: PageLoadingSpinnerProps) {
  // Read once per mount: the factory is set before the embed renders and only
  // changes on unmount.
  const [hostFactory] = useState(getHostLoadingIndicator);
  return (
    <div className={clsx("flex justify-center", className ?? "py-16")} role="status" aria-live="polite">
      {hostFactory ? <HostIndicator factory={hostFactory} /> : <SpinnerRing />}
      <span className="sr-only">{label}</span>
    </div>
  );
}

function SpinnerRing() {
  return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent-9)]" aria-hidden="true" />;
}

/**
 * Mounts a fresh host element into a box the same height as the ring. A
 * factory that throws or returns something other than an element falls back
 * to the ring, so a host bug never leaves the pane blank.
 */
function HostIndicator({ factory }: { factory: () => HTMLElement }) {
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

  if (failed) return <SpinnerRing />;
  return <span ref={ref} className="inline-flex h-8 min-w-8 items-center justify-center" aria-hidden="true" />;
}
