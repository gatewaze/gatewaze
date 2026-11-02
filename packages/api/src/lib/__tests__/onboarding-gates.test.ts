import { describe, expect, it } from 'vitest';

// The gates module lives with the edge functions it guards but is pure TS
// with no Deno globals, specifically so this suite can regression-test the
// security boundaries (the functions themselves have no test harness —
// packages/api's tsconfig rootDir is the repo root, which makes this
// import legal for typecheck as well).
import {
  claimFailureResponse,
  constantTimeEqual,
  isCiModeAuthorized,
  isStaleClaim,
  isUniqueViolation,
  MIN_CI_SECRET_LENGTH,
  shouldReleaseClaim,
  STALE_CLAIM_THRESHOLD_MS,
} from '../../../../../supabase/functions/_shared/onboarding-gates';

const GOOD_SECRET = 's'.repeat(MIN_CI_SECRET_LENGTH);

describe('isCiModeAuthorized (admin-send-magic-link direct-link gate)', () => {
  it('stays off when CI_MODE is unset', () => {
    expect(isCiModeAuthorized(undefined, GOOD_SECRET, GOOD_SECRET)).toBe(false);
  });

  it('stays off when CI_MODE is anything but true', () => {
    expect(isCiModeAuthorized('false', GOOD_SECRET, GOOD_SECRET)).toBe(false);
    expect(isCiModeAuthorized('1', GOOD_SECRET, GOOD_SECRET)).toBe(false);
  });

  it('accepts TRUE case-insensitively, matching the old env check', () => {
    expect(isCiModeAuthorized('TRUE', GOOD_SECRET, GOOD_SECRET)).toBe(true);
  });

  it('stays off when the secret is unset or empty, regardless of the flag', () => {
    expect(isCiModeAuthorized('true', undefined, GOOD_SECRET)).toBe(false);
    expect(isCiModeAuthorized('true', '', '')).toBe(false);
  });

  it('stays off when the secret is shorter than the minimum length', () => {
    const short = 's'.repeat(MIN_CI_SECRET_LENGTH - 1);
    expect(isCiModeAuthorized('true', short, short)).toBe(false);
  });

  it('stays off when the header is missing', () => {
    expect(isCiModeAuthorized('true', GOOD_SECRET, null)).toBe(false);
  });

  it('stays off when the header does not match', () => {
    expect(isCiModeAuthorized('true', GOOD_SECRET, GOOD_SECRET.slice(0, -1) + 'x')).toBe(false);
  });

  it('opens only on flag + sufficient secret + exact header match', () => {
    expect(isCiModeAuthorized('true', GOOD_SECRET, GOOD_SECRET)).toBe(true);
  });
});

describe('constantTimeEqual', () => {
  it('matches equal strings and rejects unequal ones of any length', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('', 'a')).toBe(false);
  });
});

describe('claim failure mapping (admin-add-first)', () => {
  it('treats only a unique violation as "setup already underway"', () => {
    expect(isUniqueViolation('23505')).toBe(true);
    expect(claimFailureResponse('23505')).toEqual({
      status: 409,
      message: 'Setup is already in progress or finished.',
    });
  });

  it('maps every other error to a 500, never a reassuring 409', () => {
    for (const code of ['42501', 'PGRST301', undefined, null]) {
      expect(isUniqueViolation(code)).toBe(false);
      expect(claimFailureResponse(code).status).toBe(500);
    }
  });
});

describe('stale-claim sweep threshold', () => {
  it('stays clearly beyond the 300s edge-runtime worker timeout', () => {
    // A threshold at or below the worker timeout lets a live claim be
    // swept at the boundary while its request still runs, reopening the
    // double-super-admin race this claim exists to close.
    expect(STALE_CLAIM_THRESHOLD_MS).toBeGreaterThanOrEqual(2 * 300_000);
  });

  it('keeps fresh claims and sweeps old ones', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    const fresh = new Date(now - STALE_CLAIM_THRESHOLD_MS + 1000).toISOString();
    const old = new Date(now - STALE_CLAIM_THRESHOLD_MS - 1000).toISOString();
    expect(isStaleClaim(fresh, now)).toBe(false);
    expect(isStaleClaim(old, now)).toBe(true);
  });

  it('treats an unparseable timestamp as stale so onboarding can recover', () => {
    expect(isStaleClaim('not-a-date', Date.now())).toBe(true);
  });
});

describe('shouldReleaseClaim', () => {
  it('releases only a held claim with no admin created', () => {
    expect(shouldReleaseClaim(true, false)).toBe(true);
  });

  it('never releases after success — that would reopen the one-winner gate', () => {
    expect(shouldReleaseClaim(true, true)).toBe(false);
  });

  it('never releases a claim that was not taken', () => {
    expect(shouldReleaseClaim(false, false)).toBe(false);
    expect(shouldReleaseClaim(false, true)).toBe(false);
  });
});
