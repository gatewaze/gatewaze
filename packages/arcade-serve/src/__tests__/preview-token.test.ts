import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPreviewToken, verifyPreviewToken } from '../preview-token.js';
import { DRAFT_VERSION_ID, LIVE_VERSION_ID, PREVIOUS_SECRET, SECRET } from './fixtures.js';

const NOW_MS = 1_800_000_000_000; // fixed clock
const NOW_S = Math.floor(NOW_MS / 1000);
const SECRETS = [SECRET, PREVIOUS_SECRET];

describe('verifyPreviewToken', () => {
  it('accepts a valid token signed with the current secret', () => {
    const token = signPreviewToken(DRAFT_VERSION_ID, NOW_S + 600, SECRET);
    expect(verifyPreviewToken(token, DRAFT_VERSION_ID, SECRETS, NOW_MS)).toEqual({
      ok: true,
      versionId: DRAFT_VERSION_ID,
      expiresAt: NOW_S + 600,
    });
  });

  it('accepts a token signed with the previous secret (rotation window)', () => {
    const token = signPreviewToken(DRAFT_VERSION_ID, NOW_S + 600, PREVIOUS_SECRET);
    expect(verifyPreviewToken(token, DRAFT_VERSION_ID, SECRETS, NOW_MS).ok).toBe(true);
  });

  it('rejects a token signed with a retired secret once it is dropped', () => {
    const token = signPreviewToken(DRAFT_VERSION_ID, NOW_S + 600, PREVIOUS_SECRET);
    expect(verifyPreviewToken(token, DRAFT_VERSION_ID, [SECRET], NOW_MS)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a tampered signature', () => {
    const token = signPreviewToken(DRAFT_VERSION_ID, NOW_S + 600, SECRET);
    const [payload, signature] = token.split('.');
    const flipped = signature.slice(0, -1) + (signature.slice(-1) === 'A' ? 'B' : 'A');
    expect(verifyPreviewToken(`${payload}.${flipped}`, DRAFT_VERSION_ID, SECRETS, NOW_MS).ok).toBe(false);
  });

  it('rejects a tampered payload (signature no longer covers the bytes)', () => {
    const original = Buffer.from(`v=1&vid=${DRAFT_VERSION_ID}&exp=${NOW_S + 600}`, 'latin1');
    const signature = createHmac('sha256', SECRET).update(original).digest();
    const swapped = Buffer.from(`v=1&vid=${LIVE_VERSION_ID}&exp=${NOW_S + 600}`, 'latin1');
    const token = `${swapped.toString('base64url')}.${signature.toString('base64url')}`;
    expect(verifyPreviewToken(token, LIVE_VERSION_ID, SECRETS, NOW_MS)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects an expired token', () => {
    const token = signPreviewToken(DRAFT_VERSION_ID, NOW_S - 1, SECRET);
    expect(verifyPreviewToken(token, DRAFT_VERSION_ID, SECRETS, NOW_MS)).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts a token expiring exactly now', () => {
    const token = signPreviewToken(DRAFT_VERSION_ID, NOW_S, SECRET);
    expect(verifyPreviewToken(token, DRAFT_VERSION_ID, SECRETS, NOW_MS).ok).toBe(true);
  });

  it('rejects a token minted for a different version', () => {
    const token = signPreviewToken(LIVE_VERSION_ID, NOW_S + 600, SECRET);
    expect(verifyPreviewToken(token, DRAFT_VERSION_ID, SECRETS, NOW_MS)).toEqual({
      ok: false,
      reason: 'wrong_version',
    });
  });

  it('rejects padded base64 and the base64 (non-url) alphabet', () => {
    const payload = Buffer.from(`v=1&vid=${DRAFT_VERSION_ID}&exp=${NOW_S + 600}`, 'latin1');
    const signature = createHmac('sha256', SECRET).update(payload).digest();

    const padded = `${payload.toString('base64')}.${signature.toString('base64url')}`;
    expect(verifyPreviewToken(padded, DRAFT_VERSION_ID, SECRETS, NOW_MS).ok).toBe(false);

    const paddedSig = `${payload.toString('base64url')}.${signature.toString('base64')}`;
    expect(verifyPreviewToken(paddedSig, DRAFT_VERSION_ID, SECRETS, NOW_MS).ok).toBe(false);

    // Trailing '=' padding on an otherwise valid base64url payload.
    expect(
      verifyPreviewToken(
        `${payload.toString('base64url')}=.${signature.toString('base64url')}`,
        DRAFT_VERSION_ID,
        SECRETS,
        NOW_MS,
      ).ok,
    ).toBe(false);
  });

  it.each([
    ['absent', null],
    ['empty', ''],
    ['no separator', 'abcdef'],
    ['too many parts', 'a.b.c'],
    ['garbage', '!!!.???'],
  ])('rejects a %s token', (_label, token) => {
    expect(verifyPreviewToken(token as string | null, DRAFT_VERSION_ID, SECRETS, NOW_MS).ok).toBe(false);
  });

  it('rejects a correctly signed payload in an unexpected shape', () => {
    const payload = Buffer.from(`v=2&vid=${DRAFT_VERSION_ID}&exp=${NOW_S + 600}`, 'latin1');
    const signature = createHmac('sha256', SECRET).update(payload).digest();
    const token = `${payload.toString('base64url')}.${signature.toString('base64url')}`;
    expect(verifyPreviewToken(token, DRAFT_VERSION_ID, SECRETS, NOW_MS)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects everything when no secret is configured', () => {
    const token = signPreviewToken(DRAFT_VERSION_ID, NOW_S + 600, SECRET);
    expect(verifyPreviewToken(token, DRAFT_VERSION_ID, [], NOW_MS).ok).toBe(false);
  });
});
