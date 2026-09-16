/**
 * The typed failure taxonomy (spec-mobile-app.md "Error handling").
 * Every error leaving the core API client is an ApiFailure; screens branch
 * on `kind`, never on raw status codes.
 */

import type { MobileApiFailure } from '@gatewaze/shared';

export class ApiFailure extends Error implements MobileApiFailure {
  kind: MobileApiFailure['kind'];
  status?: number;
  code?: string;

  constructor(kind: MobileApiFailure['kind'], message: string, status?: number, code?: string) {
    super(message);
    this.name = 'ApiFailure';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function isApiFailure(err: unknown): err is ApiFailure {
  return err instanceof ApiFailure;
}

/**
 * Network failures look like this, and nothing else should be mistaken for one.
 *
 * fetch rejects with a TypeError and one of a small set of messages when it
 * never got a response. Anything else that reaches here is a fault in our own
 * code, and calling that "offline" is actively harmful: the member is told to
 * check a signal that is fine, and whoever investigates starts with
 * connectivity. That is precisely what happened when a signup returned 403 and
 * the member was shown "No connection just now" — with full LTE.
 */
const NETWORK_MESSAGES = /network request failed|failed to fetch|connection (appears )?offline|timed? ?out|aborted/i;

export function toFailure(err: unknown): ApiFailure {
  if (isApiFailure(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (NETWORK_MESSAGES.test(message)) {
    return new ApiFailure('offline', message || 'Network request failed');
  }
  /**
   * 'local' rather than 'offline': something went wrong on this device that is
   * not the connection. The member gets "that did not work, try again", which
   * is honest, and nobody is sent looking at the network.
   */
  return new ApiFailure('local', message || 'Something went wrong in the app.');
}

/**
 * What to actually show somebody when a request fails.
 *
 * ── WHY THE RAW MESSAGE IS NEVER THE RIGHT ANSWER ─────────────────────────
 *
 * Callers were writing `err instanceof Error ? err.message : 'friendly text'`,
 * which looks careful and does the opposite of what it intends: a real Error
 * always wins, so the fallback only ever ran for something that was not an
 * Error at all. In a gym on one bar of LTE that put "Network request failed"
 * under the member's message, in red, which tells them nothing they can act on
 * and reads like the app broke.
 *
 * `kind` is the whole point of the taxonomy. Branch on it here, once, and let
 * every surface share the wording.
 *
 * `action` is what the member can do about it, which is usually the more
 * useful half. A caller that has a retry offers it; one that does not can
 * ignore it.
 */
export function humanMessage(err: unknown): { text: string; action: 'retry' | 'signin' | 'none' } {
  const f = toFailure(err);
  switch (f.kind) {
    case 'offline':
      return {
        text: 'No connection just now. Nothing was lost — try again when you have signal.',
        action: 'retry',
      };
    case 'auth':
      return { text: 'Your session has expired. Sign in again to carry on.', action: 'signin' };
    case 'server':
      return { text: 'Something went wrong at our end. Try again in a moment.', action: 'retry' };
    case 'client':
      // A 4xx usually carries a message written for a person by the route that
      // refused it, and that is more useful than anything generic. Only fall
      // back when it does not.
      return {
        text: f.message && f.message.length < 200 ? f.message : 'That did not work.',
        action: 'none',
      };
    case 'local':
    default:
      return { text: 'That did not work. Try again.', action: 'retry' };
  }
}

/** Classify an HTTP status into the taxonomy. */
export function failureFromStatus(status: number, message: string, code?: string): ApiFailure {
  if (status === 401) return new ApiFailure('auth', message, status, code);
  if (status >= 500) return new ApiFailure('server', message, status, code);
  return new ApiFailure('client', message, status, code);
}
