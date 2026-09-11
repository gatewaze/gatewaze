/**
 * The host-supplied element that Radix portals render into (GwHostContext.portalContainer).
 *
 * Module-level rather than React context on purpose. The consumers are Radix Themes' own
 * portalled components, reached through the build-time alias in radixThemesPortal.tsx — they are
 * not our components and we cannot thread a provider through them without editing every call site
 * in every module repo. The embed contract already guarantees at most one live mount per page
 * (see tryRegisterMount), so a single module-level value is unambiguous.
 *
 * Null is a valid state and means "fall back to Radix's own default", which is document.body.
 */
let portalContainer: HTMLElement | null = null;

/** Called by mount() before the tree renders, and again with null on unmount. */
export function setEmbedPortalContainer(el: HTMLElement | null | undefined): void {
  portalContainer = el ?? null;
}

export function getEmbedPortalContainer(): HTMLElement | null {
  return portalContainer;
}
