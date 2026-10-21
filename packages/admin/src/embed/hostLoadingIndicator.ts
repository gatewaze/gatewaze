/**
 * The host-supplied loading spinner (GwHostContext.loadingIndicator).
 *
 * Module-level for the same reason as hostNotify.ts: the consumer is the shared
 * PageLoadingSpinner, which module pages in other repos render directly, so there
 * is no provider of ours above every use. One live mount per page
 * (tryRegisterMount) makes a single value unambiguous.
 *
 * Null means "no host spinner": PageLoadingSpinner then draws its own.
 */
let factory: (() => HTMLElement) | null = null;

/** Called by mount() before the tree renders, and again with null on unmount. */
export function setHostLoadingIndicator(fn: (() => HTMLElement) | null | undefined): void {
  factory = typeof fn === 'function' ? fn : null;
}

export function getHostLoadingIndicator(): (() => HTMLElement) | null {
  return factory;
}
