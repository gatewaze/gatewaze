/**
 * The host-supplied navigation hook (GwHostContext.navigateHost).
 *
 * Module-level for the same reason as hostNotify.ts: consumers (e.g. a hub
 * card linking to another part of the host app) sit in module code with no
 * provider to thread through, and one live mount per page makes a single
 * value unambiguous.
 */

let navigateHost: ((path: string) => void) | null = null;

/** Called by mount() before the tree renders, and again with null on unmount. */
export function setHostNavigate(fn: ((path: string) => void) | null | undefined): void {
  navigateHost = fn ?? null;
}

export function getHostNavigate(): ((path: string) => void) | null {
  return navigateHost;
}
