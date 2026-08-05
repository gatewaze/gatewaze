import { describe, it, expect } from 'vitest';
import { COUNTRY_OPTIONS, getCountryNameByCode, resolveCountryCode } from '../country';

describe('COUNTRY_OPTIONS', () => {
  it('leads with an empty "unselected" option', () => {
    expect(COUNTRY_OPTIONS[0]).toEqual({ label: '— Select a country —', value: '' });
  });

  it('includes known countries as name/code pairs, sorted by name', () => {
    const us = COUNTRY_OPTIONS.find((o) => o.value === 'US');
    expect(us?.label).toBe('United States');

    const names = COUNTRY_OPTIONS.slice(1).map((o) => o.label);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

describe('getCountryNameByCode', () => {
  it('returns the full name for a known code', () => {
    expect(getCountryNameByCode('US')).toBe('United States');
    expect(getCountryNameByCode('ca')).toBe('Canada');
  });

  it('returns "" for an unknown or missing code', () => {
    expect(getCountryNameByCode('ZZ')).toBe('');
    expect(getCountryNameByCode('')).toBe('');
    expect(getCountryNameByCode(undefined)).toBe('');
    expect(getCountryNameByCode(null)).toBe('');
  });
});

describe('resolveCountryCode', () => {
  it('prefers an existing valid country_code', () => {
    expect(resolveCountryCode('US', 'Canada')).toBe('US');
  });

  it('is case-insensitive on the stored code', () => {
    expect(resolveCountryCode('us', undefined)).toBe('US');
  });

  it('falls back to matching legacy free-text country name', () => {
    expect(resolveCountryCode(undefined, 'United States')).toBe('US');
    expect(resolveCountryCode('', 'canada')).toBe('CA');
  });

  it('ignores an invalid stored code and falls back to the name', () => {
    expect(resolveCountryCode('XX', 'Canada')).toBe('CA');
  });

  it('returns "" for unmapped legacy text without throwing', () => {
    expect(resolveCountryCode(undefined, 'Not A Real Country')).toBe('');
  });

  it('returns "" when both inputs are empty', () => {
    expect(resolveCountryCode(undefined, undefined)).toBe('');
    expect(resolveCountryCode('', '')).toBe('');
  });
});
