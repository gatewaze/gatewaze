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

/** Classify an HTTP status into the taxonomy. */
export function failureFromStatus(status: number, message: string, code?: string): ApiFailure {
  if (status === 401) return new ApiFailure('auth', message, status, code);
  if (status >= 500) return new ApiFailure('server', message, status, code);
  return new ApiFailure('client', message, status, code);
}
