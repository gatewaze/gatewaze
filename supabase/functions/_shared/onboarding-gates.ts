// Pure decision logic for the two public admin edge functions
// (admin-add-first, admin-send-magic-link). Deliberately free of Deno
// globals and URL imports so packages/api's Vitest suite can import it
// (its tsconfig rootDir is the repo root) — the edge functions have no
// test harness of their own, and these gates are security boundaries
// that need regression tests.

/** How long an onboarding claim may sit before a new attempt may sweep
 * it as abandoned. Must stay clearly LONGER than the edge runtime's
 * wall-clock limit (workerTimeoutMs = 300_000 in functions/main), or a
 * still-running first request could have its live claim swept at the
 * boundary and a second super_admin minted. 2x the worker timeout also
 * absorbs ordinary DB-vs-runtime clock skew. */
export const STALE_CLAIM_THRESHOLD_MS = 10 * 60 * 1000;

/** Postgres unique-violation SQLSTATE — the one claim-insert failure
 * that means "someone else holds the claim" rather than "broken". */
export function isUniqueViolation(code: string | null | undefined): boolean {
  return code === '23505';
}

/** Maps a claim-insert error to the HTTP response pair. Only a unique
 * violation is evidence that setup is underway; anything else is a real
 * error and must not masquerade as "already configured". */
export function claimFailureResponse(code: string | null | undefined): { status: number; message: string } {
  return isUniqueViolation(code)
    ? { status: 409, message: 'Setup is already in progress or finished.' }
    : { status: 500, message: 'Could not start setup' };
}

/** Whether a claim taken at claimedAtIso counts as abandoned at nowMs. */
export function isStaleClaim(claimedAtIso: string, nowMs: number, thresholdMs: number = STALE_CLAIM_THRESHOLD_MS): boolean {
  const claimedAt = Date.parse(claimedAtIso);
  if (Number.isNaN(claimedAt)) {
    // An unparseable timestamp means a hand-edited or corrupted row;
    // treat it as stale so onboarding can recover rather than brick.
    return true;
  }
  return nowMs - claimedAt > thresholdMs;
}

/** The claim is released only when it was taken AND no admin was
 * created: releasing after success would reopen the one-winner gate. */
export function shouldReleaseClaim(claimHeld: boolean, adminCreated: boolean): boolean {
  return claimHeld && !adminCreated;
}

/** Constant-time string equality. `===` short-circuits on the first
 * differing character, which leaks match-length timing. Comparison cost
 * here depends only on the lengths, never on the contents. */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/** The gate's strength is only the secret's entropy — the endpoint is
 * public and unthrottled — so a weak secret must mean the gate stays
 * shut rather than guessable. */
export const MIN_CI_SECRET_LENGTH = 32;

/** The CI-mode gate for admin-send-magic-link's direct-link return.
 * The function is public (verify_jwt off), so the env flag alone must
 * never unlock a working sign-in link for any admin email: the caller
 * must also present the matching secret. Unset, empty, or too-short
 * secret = CI mode off, regardless of the flag. */
export function isCiModeAuthorized(
  ciModeFlag: string | undefined,
  ciSecret: string | undefined,
  headerSecret: string | null,
): boolean {
  if (ciModeFlag?.toLowerCase() !== 'true') return false;
  if (!ciSecret || ciSecret.length < MIN_CI_SECRET_LENGTH) return false;
  if (headerSecret === null) return false;
  return constantTimeEqual(headerSecret, ciSecret);
}
