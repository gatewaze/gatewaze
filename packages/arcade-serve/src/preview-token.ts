import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed preview parameter for unpublished versions (spec §6).
//
//   payload = "v=1&vid=<version_uuid>&exp=<unix_seconds>"   (exact ASCII bytes)
//   token   = base64url(payload) "." base64url(HMAC-SHA256(payload, secret))
//
// The signature is verified over the decoded payload bytes exactly as they were
// signed. The payload is parsed only AFTER the signature checks out, and the
// parse result is never re-serialised for comparison.

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const PAYLOAD_RE = /^v=1&vid=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})&exp=([0-9]{1,10})$/;

export type PreviewResult =
  | { ok: true; versionId: string; expiresAt: number }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_version' };

function decodeStrictBase64Url(part: string): Buffer | null {
  // Unpadded base64url only: padding ('='), '+' and '/' are all rejected, and
  // the decode must round-trip so non-canonical encodings cannot slip through.
  if (!BASE64URL_RE.test(part)) return null;
  const buf = Buffer.from(part, 'base64url');
  if (buf.length === 0) return null;
  if (buf.toString('base64url') !== part) return null;
  return buf;
}

function signatureMatches(payload: Buffer, signature: Buffer, secrets: string[]): boolean {
  let matched = false;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(payload).digest();
    // Length check first — timingSafeEqual throws on a mismatch. Every secret is
    // tried even after a hit so rotation does not become a timing oracle.
    const hit = expected.length === signature.length && timingSafeEqual(expected, signature);
    matched = matched || hit;
  }
  return matched;
}

/**
 * Verify a `?p=` preview token against the path's version id.
 *
 * @param token     raw query-parameter value
 * @param versionId version id from the URL path (lowercase uuid)
 * @param secrets   current secret first, previous secret (rotation) after
 * @param nowMs     injectable clock for tests
 */
export function verifyPreviewToken(
  token: string | null | undefined,
  versionId: string,
  secrets: string[],
  nowMs: number = Date.now(),
): PreviewResult {
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    return { ok: false, reason: 'malformed' };
  }
  if (secrets.length === 0) return { ok: false, reason: 'bad_signature' };

  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  const payloadBytes = decodeStrictBase64Url(parts[0]);
  const signatureBytes = decodeStrictBase64Url(parts[1]);
  if (!payloadBytes || !signatureBytes) return { ok: false, reason: 'malformed' };
  if (signatureBytes.length !== 32) return { ok: false, reason: 'bad_signature' };

  if (!signatureMatches(payloadBytes, signatureBytes, secrets)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Signature verified — only now is it safe to interpret the payload.
  const payload = payloadBytes.toString('latin1');
  const match = PAYLOAD_RE.exec(payload);
  if (!match) return { ok: false, reason: 'malformed' };

  if (match[1].toLowerCase() !== versionId.toLowerCase()) {
    return { ok: false, reason: 'wrong_version' };
  }

  const exp = Number(match[2]);
  if (!Number.isSafeInteger(exp)) return { ok: false, reason: 'malformed' };
  if (exp < Math.floor(nowMs / 1000)) return { ok: false, reason: 'expired' };

  return { ok: true, versionId: match[1].toLowerCase(), expiresAt: exp };
}

/** Mint helper — used by tests and by operators debugging a preview link. */
export function signPreviewToken(versionId: string, expUnixSeconds: number, secret: string): string {
  const payload = Buffer.from(`v=1&vid=${versionId}&exp=${expUnixSeconds}`, 'latin1');
  const signature = createHmac('sha256', secret).update(payload).digest();
  return `${payload.toString('base64url')}.${signature.toString('base64url')}`;
}
