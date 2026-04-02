export const REGION_NAMES: Record<string, string> = {
  as: 'Asia',
  af: 'Africa',
  eu: 'Europe',
  na: 'North America',
  sa: 'South America',
  oc: 'Oceania',
  on: 'Online',
}

export const REGION_CODES = Object.keys(REGION_NAMES) as RegionCode[]

export type RegionCode = 'as' | 'af' | 'eu' | 'na' | 'sa' | 'oc' | 'on'

export function isRegionCode(value: string): value is RegionCode {
  return value in REGION_NAMES
}
