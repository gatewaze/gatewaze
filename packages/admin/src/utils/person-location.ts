/**
 * Person profile map/label reconciliation.
 *
 * The People profile renders a location *label* ("Toronto, Canada") from the
 * text fields `attributes.city` / `attributes.country`, and a *map* from the
 * numeric `attributes.coordinates` / `attributes.location`. Those two families
 * are populated by different pipelines and are allowed to disagree:
 *
 * - `coordinates` is written by the profile editor's forward-geocode of the
 *   displayed city/country (see `geocodeCityCountry`), so it should agree with
 *   the label — but only if the label hasn't changed since it was written.
 * - `location` is written by the async `people-normalize-location` edge
 *   function, which includes an IP-geolocation fallback (`ip-api.com`). An
 *   IP hit can put the map in a different country than an explicitly-entered
 *   city/country.
 *
 * The result was a map centred on the UK under a "Toronto, Canada" label.
 *
 * These pure helpers are the single source of truth for "which coordinates
 * should the map show, given the label", so the card and the hero can't drift
 * apart, and the rule is unit-testable in isolation.
 */

export interface PersonMapCoords {
  lat: number;
  lng: number;
}

export type PersonMapSource = 'coordinates' | 'location';

export interface ResolvedPersonMap {
  coords: PersonMapCoords;
  /** Which attribute family the coordinates came from. */
  source: PersonMapSource;
}

/** Parse a `"lat,lng"` string into numeric coords, or null if unusable. */
export function parseCoordString(raw: unknown): PersonMapCoords | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',');
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0].trim());
  const lng = parseFloat(parts[1].trim());
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  // Reject out-of-range values so a corrupt string can't centre the map on a
  // nonsense point.
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Normalised key identifying which city/country a coordinate was derived from.
 * Stored alongside coordinates as `attributes._coordinates_for` so a later
 * city/country change can be detected as making the coordinates stale.
 */
export function locationLabelKey(city?: unknown, country?: unknown): string {
  const c = typeof city === 'string' ? city.trim().toLowerCase() : '';
  const co = typeof country === 'string' ? country.trim().toLowerCase() : '';
  return `${c}|${co}`;
}

/** True when the person has a city or country label the map must agree with. */
export function hasLocationLabel(attributes: Record<string, unknown> | null | undefined): boolean {
  const attrs = attributes ?? {};
  const city = typeof attrs.city === 'string' ? attrs.city.trim() : '';
  const country = typeof attrs.country === 'string' ? attrs.country.trim() : '';
  return Boolean(city || country);
}

/**
 * Resolve the coordinates the profile map should render, keeping the map in
 * agreement with the city/country label.
 *
 * Resolution order:
 * 1. `coordinates` when it's trustworthy — either it carries a
 *    `_coordinates_for` marker that still matches the displayed label, or it
 *    has no marker (legacy data written by the editor's geocode of the label,
 *    assumed aligned).
 * 2. `location`, but ONLY when there's no city/country label for it to
 *    contradict (e.g. an IP-derived point on a record with no explicit city).
 *
 * Returns null when there is no coordinate we can plot without risking a
 * label/map mismatch — the caller may then geocode the label to self-heal.
 */
export function resolvePersonMapCoords(
  attributes: Record<string, unknown> | null | undefined,
): ResolvedPersonMap | null {
  const attrs = attributes ?? {};
  const labelled = hasLocationLabel(attrs);

  const coords = parseCoordString(attrs.coordinates);
  if (coords) {
    const marker = typeof attrs._coordinates_for === 'string' ? attrs._coordinates_for : null;
    if (marker !== null && labelled) {
      // We know which label these coordinates were geocoded from — trust them
      // only if that still matches the label being displayed. A mismatch means
      // the city/country changed after the coordinates were written (stale).
      if (marker === locationLabelKey(attrs.city, attrs.country)) {
        return { coords, source: 'coordinates' };
      }
    } else {
      // Legacy coordinates (no provenance marker) are assumed to be the
      // editor's geocode of the label; trust them.
      return { coords, source: 'coordinates' };
    }
  }

  // No trustworthy `coordinates`. Fall back to the normaliser's `location`
  // ONLY when there's no label it could contradict — otherwise an IP-derived
  // point would override an explicit city/country.
  if (!labelled) {
    const loc = parseCoordString(attrs.location);
    if (loc) return { coords: loc, source: 'location' };
  }

  return null;
}
