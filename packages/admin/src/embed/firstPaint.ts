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

/** Called by mount() before the tree renders. `onSignal` runs once, as the event is dispatched. */
export function armFirstPaint(el: HTMLElement, onSignal?: () => void): void {
  armed = { el, onSignal };
}

/** Called by unmount(): a signal that has not fired yet never will. */
export function disarmFirstPaint(): void {
  armed = null;
}

export function signalFirstPaint(): void {
  const target = armed;
  if (!target) return;
  armed = null;
  const fire = () => {
    try {
      target.el.dispatchEvent(new CustomEvent(FIRST_PAINT_EVENT));
      target.onSignal?.();
    } catch (err) {
      // Event listeners report their own errors; this catches onSignal (the
      // host's telemetry sink), which must not break the embed.
      console.warn('[gw-embed] first-paint signal failed', err);
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fire);
  else fire();
}

/** Signals first paint once the calling component has committed. */
export function useFirstPaintSignal(): void {
  useEffect(() => {
    signalFirstPaint();
  }, []);
}
