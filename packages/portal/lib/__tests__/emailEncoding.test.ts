import { describe, it, expect } from 'vitest';
import { encodeEmail, decodeEmail, getEmailFromParams } from '../emailEncoding';

describe('encodeEmail / decodeEmail', () => {
  it('round-trips an email correctly', () => {
    const email = 'jane@example.com';
    const encoded = encodeEmail(email);
    expect(encoded).not.toBe(email);
    expect(decodeEmail(encoded)).toBe(email);
  });

  it('lowercases email before encoding', () => {
    const encoded = encodeEmail('Jane@Example.COM');
    expect(decodeEmail(encoded)).toBe('jane@example.com');
  });

  it('returns empty string for empty input', () => {
    expect(encodeEmail('')).toBe('');
  });

  it('returns null for empty encoded input', () => {
    expect(decodeEmail('')).toBeNull();
  });

  it('returns null for invalid encoded data', () => {
    expect(decodeEmail('not-valid-base64!!!')).toBeNull();
  });

  it('produces URL-safe Base64 (no +, /, =)', () => {
    const encoded = encodeEmail('test+special@example.com');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });
});

describe('getEmailFromParams', () => {
  it('returns direct email parameter', () => {
    const params = new URLSearchParams('email=jane@example.com');
    expect(getEmailFromParams(params)).toBe('jane@example.com');
  });

  it('lowercases and trims direct email', () => {
    const params = new URLSearchParams('email= JANE@Example.COM ');
    expect(getEmailFromParams(params)).toBe('jane@example.com');
  });

  it('decodes email from utm_medium parameter', () => {
    const encoded = encodeEmail('bob@example.com');
    const params = new URLSearchParams(`utm_medium=${encoded}`);
    expect(getEmailFromParams(params)).toBe('bob@example.com');
  });

  it('decodes email from e parameter', () => {
    const encoded = encodeEmail('carol@example.com');
    const params = new URLSearchParams(`e=${encoded}`);
    expect(getEmailFromParams(params)).toBe('carol@example.com');
  });

  it('returns null when no email params present', () => {
    const params = new URLSearchParams('foo=bar');
    expect(getEmailFromParams(params)).toBeNull();
  });

  it('ignores non-email values in email param', () => {
    const params = new URLSearchParams('email=notanemail');
    expect(getEmailFromParams(params)).toBeNull();
  });
});
