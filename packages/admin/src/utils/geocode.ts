/**
 * Forward-geocode a city/country to "lat,lng" using OpenStreetMap Nominatim.
 *
 * Used by the admin People profile editor so that changing a person's city or
 * country refreshes their map coordinates. Runs in the browser (Nominatim
 * returns permissive CORS headers, so it works under the admin's COEP:
 * credentialless policy). Keep the call volume low — this is one lookup per
 * manual profile save, well within Nominatim's usage policy.
 *
 * Returns "<lat>,<lng>" or null when nothing usable is found / the request
 * fails. Callers should treat null as "leave existing coordinates alone".
 */
export async function geocodeCityCountry(
  city?: string | null,
  country?: string | null,
  state?: string | null,
): Promise<string | null> {
  const c = (city ?? '').trim();
  const co = (country ?? '').trim();
  const st = (state ?? '').trim();
  if (!c && !co) return null;

  const params = new URLSearchParams({ format: 'json', limit: '1' });
  if (c) params.set('city', c);
  if (co) params.set('country', co);
  if (st) params.set('state', st);

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0]?.lat && data[0]?.lon) {
      return `${data[0].lat},${data[0].lon}`;
    }
    return null;
  } catch {
    return null;
  }
}
