import { useState } from "react";
import clsx from "clsx";

import { getHostLoadingIndicator } from "@/embed/hostLoadingIndicator";

import { HostIndicator } from "./HostIndicator";

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
 * Shared so that the loading states on the way into a page look the same. The
 * embed's route fallback and FeatureGuard's permission check draw it, and a
 * module page can draw it for its own data load. Each one then replaces the
 * last in the same place, and the hand-over reads as one spinner rather than a
 * blank pane followed by a jump.
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
      {hostFactory ? <HostIndicator factory={hostFactory} fallback={<SpinnerRing />} className="h-8 min-w-8" /> : <SpinnerRing />}
      <span className="sr-only">{label}</span>
    </div>
  );
}

function SpinnerRing() {
  return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent-9)]" aria-hidden="true" />;
}
