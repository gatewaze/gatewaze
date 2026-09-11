/**
 * The host-supplied notification sink (GwHostContext.notify).
 *
 * Module-level for the same reason as portalContainer.ts: the consumers are `toast()` calls spread
 * across every module repo, reached through the build-time `sonner` alias in sonnerHostBridge.tsx
 * rather than through our own component tree, so there is no provider to thread. One live mount per
 * page (tryRegisterMount) makes a single value unambiguous.
 *
 * Null means "no host sink" — the bridge then falls through to sonner's own toaster, which is what
 * keeps the embed usable in a host that does not implement this optional part of the contract.
 */
import type { GwEmbedNotification } from './types';

let notify: ((notification: GwEmbedNotification) => void) | null = null;

/** Called by mount() before the tree renders, and again with null on unmount. */
export function setHostNotify(fn: ((notification: GwEmbedNotification) => void) | null | undefined): void {
  notify = fn ?? null;
}

export function getHostNotify(): ((notification: GwEmbedNotification) => void) | null {
  return notify;
}
