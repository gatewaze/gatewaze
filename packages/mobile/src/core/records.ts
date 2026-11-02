/**
 * A module says what changed; other modules act on it.
 *
 * Modules may not import each other. That rule is what keeps the app a set of
 * independent parts rather than a graph, and the dependency audit enforces it.
 * But some things genuinely span two modules: a workout belongs to
 * health-fitness, and mirroring it into Apple Health belongs to
 * health-body-metrics, which owns the connection and the member's permission.
 *
 * Without something like this the choice is a module importing another
 * module's code, or the feature not existing. This is the third option: the
 * owner announces, and anything that cares listens. Neither side names the
 * other, so a build with only one of them works exactly as before, with the
 * announcement going nowhere.
 *
 * Deliberately not persisted and not a queue. A listener that misses an event
 * because it was not installed has not lost anything it could have acted on.
 * Anything needing delivery guarantees should use the outbox instead.
 */

/** What kind of thing changed. Open by design: a module may announce its own. */
export type RecordKind = string;

export interface RecordEvent {
  kind: RecordKind;
  /** What happened, so a listener can tell a new row from an edited one. */
  action: 'created' | 'updated' | 'deleted';
  /** The record's id in the announcing module. */
  id: string;
  /** Whatever a listener needs. The announcing module decides the shape. */
  data?: Record<string, unknown>;
}

type Listener = (event: RecordEvent) => void | Promise<void>;

const listeners = new Set<Listener>();

/**
 * Listen for records changing anywhere in the app.
 *
 * Returns an unsubscribe. Call it from `onSessionReady`, which is the point at
 * which a module knows it is enabled for this member.
 */
export function onRecordChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Tell anyone who cares that a record changed.
 *
 * Never throws and never waits. A listener that fails is a listener's problem:
 * mirroring a workout into Apple Health must not be able to fail the workout
 * that was just saved.
 */
export function announceRecord(event: RecordEvent): void {
  for (const fn of listeners) {
    try {
      const r = fn(event);
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => undefined);
      }
    } catch {
      // See above.
    }
  }
}
