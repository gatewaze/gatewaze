/**
 * The 'first-paint' capability: tell the host, once, that the embed has put
 * something on screen (the route's content or its loading spinner), so a
 * host waiting on it knows the pane is no longer blank.
 *
 * mount() arms it with the mount element; the first component to commit
 * calls signalFirstPaint() from an effect, which dispatches FIRST_PAINT_EVENT
 * on that element on the next animation frame (after the browser has had a
 * chance to paint the commit). Every later call is a no-op, and so is any
 * call when nothing is armed (the standalone app). Module-level, like
 * hostNotify.ts: one live mount per page.
 */
import { useEffect } from 'react';

import { FIRST_PAINT_EVENT } from './contract';

let armed: { el: HTMLElement; onSignal?: () => void } | null = null;
// The signal waiting for its animation frame, so unmount can cancel it.
let pending: { frame: number | null; cancelled: boolean } | null = null;

/** Called by mount() before the tree renders. `onSignal` runs once, as the event is dispatched. */
export function armFirstPaint(el: HTMLElement, onSignal?: () => void): void {
  disarmFirstPaint();
  armed = { el, onSignal };
}

/**
 * Called by unmount(): a signal that has not fired yet never will, including
 * one already waiting for its animation frame. Otherwise a host that mounts
 * again into the same element within that frame would take the old mount's
 * event as the new one's.
 */
export function disarmFirstPaint(): void {
  armed = null;
  if (pending) {
    pending.cancelled = true;
    if (pending.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pending.frame);
    pending = null;
  }
}

export function signalFirstPaint(): void {
  const target = armed;
  if (!target) return;
  armed = null;
  const signal: { frame: number | null; cancelled: boolean } = { frame: null, cancelled: false };
  const fire = () => {
    if (signal.cancelled) return;
    if (pending === signal) pending = null;
    try {
      target.el.dispatchEvent(new CustomEvent(FIRST_PAINT_EVENT));
      target.onSignal?.();
    } catch (err) {
      // Event listeners report their own errors; this catches onSignal (the
      // host's telemetry sink), which must not break the embed.
      console.warn('[gw-embed] first-paint signal failed', err);
    }
  };
  // A hidden tab runs no animation frames until it is shown, and paints
  // nothing meanwhile, so the signal goes out straight away there.
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (!hidden && typeof requestAnimationFrame === 'function') {
    pending = signal;
    signal.frame = requestAnimationFrame(fire);
  } else {
    fire();
  }
}

/** Signals first paint once the calling component has committed. */
export function useFirstPaintSignal(): void {
  useEffect(() => {
    signalFirstPaint();
  }, []);
}
