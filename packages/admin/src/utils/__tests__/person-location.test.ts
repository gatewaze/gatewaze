import { describe, it, expect } from 'vitest';
import {
  parseCoordString,
  locationLabelKey,
  hasLocationLabel,
  resolvePersonMapCoords,
} from '../person-location';

describe('parseCoordString', () => {
  it('parses a well-formed "lat,lng" string', () => {
    expect(parseCoordString('43.6532,-79.3832')).toEqual({ lat: 43.6532, lng: -79.3832 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseCoordString(' 51.5074 , -0.1278 ')).toEqual({ lat: 51.5074, lng: -0.1278 });
  });

  it('returns null for non-strings, empty, or malformed input', () => {
    expect(parseCoordString(undefined)).toBeNull();
    expect(parseCoordString(null)).toBeNull();
    expect(parseCoordString(42)).toBeNull();
    expect(parseCoordString('')).toBeNull();
    expect(parseCoordString('43.6532')).toBeNull();
    expect(parseCoordString('not,coords')).toBeNull();
  });

  it('rejects out-of-range coordinates', () => {
    expect(parseCoordString('200,0')).toBeNull();
    expect(parseCoordString('0,999')).toBeNull();
  });
});

describe('locationLabelKey', () => {
  it('normalises case and whitespace', () => {
    expect(locationLabelKey('  Toronto ', 'Canada')).toBe('toronto|canada');
    expect(locationLabelKey('toronto', 'canada')).toBe('toronto|canada');
  });

  it('handles missing / non-string parts', () => {
    expect(locationLabelKey(undefined, 'Canada')).toBe('|canada');
    expect(locationLabelKey('Toronto', undefined)).toBe('toronto|');
    expect(locationLabelKey(42, null)).toBe('|');
  });
});

describe('hasLocationLabel', () => {
  it('is true when a city or country is present', () => {
    expect(hasLocationLabel({ city: 'Toronto' })).toBe(true);
    expect(hasLocationLabel({ country: 'Canada' })).toBe(true);
  });

  it('is false when both are blank or missing', () => {
    expect(hasLocationLabel({})).toBe(false);
    expect(hasLocationLabel(null)).toBe(false);
    expect(hasLocationLabel({ city: '   ', country: '' })).toBe(false);
  });
});

describe('resolvePersonMapCoords', () => {
  it('regression: does NOT plot the IP-derived `location` under a contradicting label', () => {
    // The reported bug: label "Toronto, Canada" but `location` is a UK point
    // from the normaliser's IP fallback, and `coordinates` is absent.
    const attrs = {
      city: 'Toronto',
      country: 'Canada',
      location: '51.5074,-0.1278', // London, UK — must NOT be shown
    };
    expect(resolvePersonMapCoords(attrs)).toBeNull();
  });

  it('trusts `coordinates` whose provenance marker matches the label', () => {
    const attrs = {
      city: 'Toronto',
      country: 'Canada',
      coordinates: '43.6532,-79.3832',
      _coordinates_for: 'toronto|canada',
    };
    expect(resolvePersonMapCoords(attrs)).toEqual({
      coords: { lat: 43.6532, lng: -79.3832 },
      source: 'coordinates',
    });
  });

  it('rejects `coordinates` whose marker no longer matches the label (stale)', () => {
    const attrs = {
      city: 'Toronto',
      country: 'Canada',
      coordinates: '51.5074,-0.1278', // geocoded from an old London label
      _coordinates_for: 'london|united kingdom',
    };
    expect(resolvePersonMapCoords(attrs)).toBeNull();
  });

  it('trusts legacy `coordinates` with no marker (editor-geocoded from the label)', () => {
    const attrs = {
      city: 'Toronto',
      country: 'Canada',
      coordinates: '43.6532,-79.3832',
    };
    expect(resolvePersonMapCoords(attrs)).toEqual({
      coords: { lat: 43.6532, lng: -79.3832 },
      source: 'coordinates',
    });
  });

  it('falls back to `location` only when there is no label to contradict', () => {
    const attrs = { location: '51.5074,-0.1278' };
    expect(resolvePersonMapCoords(attrs)).toEqual({
      coords: { lat: 51.5074, lng: -0.1278 },
      source: 'location',
    });
  });

  it('returns null when nothing usable is present', () => {
    expect(resolvePersonMapCoords({})).toBeNull();
    expect(resolvePersonMapCoords(null)).toBeNull();
    expect(resolvePersonMapCoords({ coordinates: 'garbage' })).toBeNull();
  });
});
