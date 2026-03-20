import { describe, it, expect } from 'vitest';
import { REGION_NAMES, REGION_CODES, isRegionCode } from '../regions';

describe('REGION_NAMES', () => {
  it('has 7 regions', () => {
    expect(Object.keys(REGION_NAMES)).toHaveLength(7);
  });

  it('includes expected regions', () => {
    expect(REGION_NAMES['na']).toBe('North America');
    expect(REGION_NAMES['eu']).toBe('Europe');
    expect(REGION_NAMES['on']).toBe('Online');
  });
});

describe('REGION_CODES', () => {
  it('matches the keys of REGION_NAMES', () => {
    expect(REGION_CODES).toEqual(Object.keys(REGION_NAMES));
  });
});

describe('isRegionCode', () => {
  it('returns true for valid region codes', () => {
    expect(isRegionCode('na')).toBe(true);
    expect(isRegionCode('eu')).toBe(true);
    expect(isRegionCode('on')).toBe(true);
  });

  it('returns false for invalid region codes', () => {
    expect(isRegionCode('xx')).toBe(false);
    expect(isRegionCode('')).toBe(false);
    expect(isRegionCode('North America')).toBe(false);
  });
});
