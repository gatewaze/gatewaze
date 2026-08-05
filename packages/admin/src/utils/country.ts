import { countries, type Country } from '@/constants/countries';

/**
 * Country dropdown options for the person edit form, sorted alphabetically by
 * name. Values are ISO-3166-1 2-letter codes; a leading empty option lets an
 * unset country stay unset rather than defaulting to the first entry.
 */
export const COUNTRY_OPTIONS: { label: string; value: string }[] = [
  { label: '— Select a country —', value: '' },
  ...[...countries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ label: c.name, value: c.code })),
];

const countriesByCode: Map<string, Country> = new Map(
  countries.map((c) => [c.code.toUpperCase(), c]),
);

const countriesByName: Map<string, Country> = new Map(
  countries.map((c) => [c.name.toLowerCase(), c]),
);

/** Full country name for a 2-letter ISO code, or '' if unknown. */
export function getCountryNameByCode(code: string | undefined | null): string {
  if (!code) return '';
  return countriesByCode.get(code.toUpperCase())?.name ?? '';
}

/**
 * Resolve which country code the edit form's dropdown should preselect,
 * given the person's stored attributes. Prefers an existing `country_code`
 * when it's a known code; falls back to matching legacy free-text `country`
 * against a known country name; otherwise returns '' (unmapped/empty) so the
 * dropdown shows the "unselected" option without discarding the raw text.
 */
export function resolveCountryCode(
  countryCode: string | undefined | null,
  countryName: string | undefined | null,
): string {
  if (countryCode && countriesByCode.has(countryCode.toUpperCase())) {
    return countryCode.toUpperCase();
  }
  const trimmedName = typeof countryName === 'string' ? countryName.trim().toLowerCase() : '';
  if (trimmedName) {
    const match = countriesByName.get(trimmedName);
    if (match) return match.code;
  }
  return '';
}
