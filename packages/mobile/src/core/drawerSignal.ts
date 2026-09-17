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

/**
 * A bug report raised from a pushed screen, with the screenshot already taken.
 *
 * The report sheet lives inside the drawer host, which sits BELOW a pushed
 * module screen in the stack — so a screen cannot open it, and opening it
 * from underneath would render it invisibly behind whatever is on top. Until
 * this existed the bug button simply was not offered on those screens, which
 * is most of the app: a tester could only report a problem from the coach
 * home, having first navigated away from the thing they wanted to report.
 *
 * The SCREENSHOT is why this carries a payload rather than being a bare flag
 * like the two above. It has to be captured while the screen in question is
 * still on top, because a moment later it will not be. Capture first, then
 * pop back, then open the sheet with the image already in hand.
 */
let bugRequest: { shot: string | null; route: string } | null = null;

/** Raise a report about the screen that is on top right now. */
export function requestBugReport(shot: string | null, route: string): void {
  bugRequest = { shot, route };
}

/** The outstanding report, clearing it. Null when there is none. */
export function consumeBugReportRequest(): { shot: string | null; route: string } | null {
  const held = bugRequest;
  bugRequest = null;
  return held;
}
