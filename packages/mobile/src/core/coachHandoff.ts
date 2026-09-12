/**
 * Carrying a message from another destination to the coach.
 *
 * The composer belongs to the coach thread: sending owns the thread's state,
 * the send queue, and the scroll position, and the mode surfaces render inside
 * the coach's own content area. Rendering a second working copy on every
 * destination would mean two of each, which is how a thread ends up with a
 * message in one place and the reply in another.
 *
 * So the other destinations get a bar that collects a message and then hands
 * it over. This is the handover. The same shape as `drawerSignal`, and for the
 * same reason: it is a FLAG, not an event. The coach is not mounted at the
 * moment the member presses send, so an event would be published to nobody.
 * Leaving it here and letting the coach pick it up on focus is what makes one
 * press enough.
 */

/**
 * Something left for the coach to pick up on focus.
 *
 * Two shapes, and they are genuinely different things rather than one thing
 * with optional fields:
 *
 *   - a MESSAGE the member composed somewhere else, to be sent;
 *   - a NOTICE the server sent them, to be acknowledged.
 *
 * A notice carries no text of its own. The coach renders it through the
 * contributing module's thread card, so acknowledging a medication reminder
 * lands on the take/skip card health-meds already has rather than on a second
 * surface built for notifications.
 */
export type Handoff =
  | {
      kind?: 'message';
      /** Text to send as soon as the coach is ready. Empty when only a mode. */
      text: string;
      /** A composer mode to open, as '<moduleId>:<id>'. */
      mode: string | null;
    }
  | {
      kind: 'notice';
      notice: { noticeId: string; sendId: string; payload?: unknown };
    };

let pending: Handoff | null = null;

/** Ask the coach to send this, or open this mode, when it next has focus. */
export function requestCoachHandoff(handoff: Handoff): void {
  pending = handoff;
}

/**
 * Is a handover waiting? Does NOT clear it.
 *
 * The drawer host uses this to decide whether to switch to the coach, and the
 * coach then consumes the handover itself. Two readers, one clear.
 */
export function hasPendingHandoff(): boolean {
  return pending !== null;
}

/**
 * Take the pending handover, if there is one. Clears it, so a re-render or a
 * second focus does not send the same message twice.
 */
export function consumeCoachHandoff(): Handoff | null {
  const held = pending;
  pending = null;
  return held;
}
