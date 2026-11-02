/**
 * Routing a tapped notification to the coach, for the life of the app.
 *
 * ── WHY THIS IS A HOOK IN THE ROOT AND NOT A MODULE'S JOB ─────────────────
 *
 * `onNoticeTapped` has to be listening before the member taps, and the most
 * valuable tap is the one that LAUNCHES the app from cold — at which point no
 * module screen is mounted and no module code has run. A module that wired this
 * up in its own screen would catch every tap except the ones that mattered.
 *
 * It also has to be wired exactly once. Two listeners would hand the same
 * notice over twice, and the second would overwrite the first's pending
 * handover, which is silent and looks like nothing happening.
 *
 * ── IT DOES NOT NAVIGATE ──────────────────────────────────────────────────
 *
 * It leaves the notice pending and lets the coach pick it up on focus.
 * `requestCoachHandoff` already survives a cold start, which a direct
 * navigation would not: on a launch-by-tap the router is not ready yet, and a
 * push issued now is a push into nothing.
 */

import { useEffect } from 'react';
import { onNoticeTapped, handOffToCoach, isAvailable } from '../capabilities/notifications';

export function useNoticeTaps(): void {
  useEffect(() => {
    // A build with no module that notifies still runs this; the capability
    // reports unavailable and nothing is subscribed.
    if (!isAvailable()) return undefined;
    return onNoticeTapped(handOffToCoach);
  }, []);
}
