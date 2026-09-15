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

export function toFailure(err: unknown): ApiFailure {
  if (isApiFailure(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  // fetch network errors (no response at all) are the offline class
  return new ApiFailure('offline', message || 'Network request failed');
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
