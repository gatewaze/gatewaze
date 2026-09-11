/**
 * A pending request to open the drawer, from somewhere that cannot reach its
 * state.
 *
 * The drawer lives inside the coach route, so a pushed module screen sits
 * ABOVE it in the navigation stack and cannot toggle it directly. Without
 * this, such a screen can only offer a back chevron, which makes a module
 * destination feel like a separate app rather than part of this one.
 *
 * This is a flag rather than an event, and that matters. The header button
 * navigates back to the coach route and asks for the drawer in the same
 * gesture, so the ask happens while that route is still being restored. An
 * event fired at that moment is either delivered to a component about to be
 * re-rendered, or delivered before the route is ready and dropped, which is
 * why the first press appeared to do nothing and only the second worked. A
 * flag survives until the coach route is actually focused and can act on it.
 */

let pending = false;

/** Ask for the drawer. Safe to call before the coach route is on screen. */
export function requestOpenDrawer(): void {
  pending = true;
}

/**
 * Whether a request is outstanding, clearing it. Called by the drawer when
 * its route gains focus, which is the first moment it can honour one.
 */
export function consumeOpenDrawerRequest(): boolean {
  const requested = pending;
  pending = false;
  return requested;
}

/**
 * The same flag, for the drawer on the right.
 *
 * A pushed screen sits above the drawer host in the stack, so it cannot open
 * either drawer itself. It leaves a request and pops back, and the host acts
 * on it when it regains focus — which is what makes one swipe enough rather
 * than two.
 */
let summaryPending = false;

export function requestOpenSummary(): void {
  summaryPending = true;
}

export function consumeOpenSummaryRequest(): boolean {
  const held = summaryPending;
  summaryPending = false;
  return held;
}
