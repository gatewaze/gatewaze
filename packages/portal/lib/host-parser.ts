// Host parser for the local-dev hostname standardisation
// (spec-local-dev-hostnames.md). Parses request hostnames into a
// discriminated `ParsedHost` union the middleware can switch on.
//
// Production wires the same function with the production domain as
// `brandLocalDomain`, so the parser is environment-agnostic.

import type { CustomDomainRow } from './host-parser-types'

export type ParsedHost =
  | { kind: 'portal'; brand: string }
  | { kind: 'site'; brand: string; slug: string }
  | { kind: 'custom-domain'; record: CustomDomainRow }
  | { kind: 'unknown'; reason: ParseUnknownReason }

export type ParseUnknownReason =
  | 'malformed'
  | 'suffix-mismatch'
  | 'unrecognized-surface'
  | 'slug-invalid'
  | 'no-brand-domain'

// RFC 1035 §2.3.4: a single DNS label is 1–63 octets.
export const SLUG_RE = /^[a-z0-9-]{1,63}$/
export const BRAND_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

const HOST_CHARS_RE = /^[a-z0-9.-]+$/

type BrandEnv = { BRAND_LOCAL_DOMAIN?: string; BRAND_ID?: string }

// `env` is intentionally a narrow shape — the function only reads two
// keys, and forcing callers to populate the full NodeJS.ProcessEnv
// (with NODE_ENV etc.) for tests is not useful.
export function getBrandLocalDomain(env: BrandEnv = process.env as BrandEnv): string {
  if (env.BRAND_LOCAL_DOMAIN) {
    if (!HOST_CHARS_RE.test(env.BRAND_LOCAL_DOMAIN)) {
      throw new Error(`BRAND_LOCAL_DOMAIN invalid: ${env.BRAND_LOCAL_DOMAIN}`)
    }
    return env.BRAND_LOCAL_DOMAIN
  }
  if (!env.BRAND_ID) {
    throw new Error('BRAND_LOCAL_DOMAIN cannot be derived: BRAND_ID is unset')
  }
  if (!BRAND_ID_RE.test(env.BRAND_ID)) {
    throw new Error(`BRAND_ID is not a valid DNS label: ${env.BRAND_ID}`)
  }
  return `${env.BRAND_ID}.localhost`
}

function normalize(rawHostname: string): string | null {
  const noPort = rawHostname.split(':')[0] ?? ''
  const lower = noPort.toLowerCase()
  const trimmed = lower.endsWith('.') ? lower.slice(0, -1) : lower
  if (!trimmed) return null
  if (!HOST_CHARS_RE.test(trimmed)) return null
  return trimmed
}

export type CustomDomainLookup = (host: string) => Promise<CustomDomainRow | null>

// Run new-pattern dispatch on labels remaining after suffix-strip.
// Returns null if the label set isn't recognised by the new pattern;
// callers fall through to the legacy parser.
function dispatchNewPattern(labels: string[], brand: string): ParsedHost | null {
  if (labels.length === 0 || (labels.length === 1 && labels[0] === 'app')) {
    return { kind: 'portal', brand }
  }
  if (labels.length === 2 && labels[1] === 'sites') {
    const slug = labels[0]
    if (!SLUG_RE.test(slug)) {
      return { kind: 'unknown', reason: 'slug-invalid' }
    }
    return { kind: 'site', brand, slug }
  }
  return null
}

// Strip BRAND_LOCAL_DOMAIN suffix; returns the labels array (empty if
// the host equals brandLocalDomain itself), or null on suffix mismatch.
function stripBrandSuffix(host: string, brandLocalDomain: string): string[] | null {
  if (host === brandLocalDomain) return []
  if (host.endsWith(`.${brandLocalDomain}`)) {
    const remainder = host.slice(0, -1 - brandLocalDomain.length)
    // ''.split('.') returns [''], not [] — guard explicitly.
    return remainder === '' ? [] : remainder.split('.')
  }
  return null
}

// Legacy `<brand>-<surface>.localhost` pattern. Removed in step 9 of the
// migration plan once all brand stacks rebuild on the new pattern.
function dispatchLegacyPattern(host: string, expectedBrand: string): ParsedHost | null {
  if (!host.endsWith('.localhost')) return null
  const head = host.slice(0, -'.localhost'.length)
  if (!head) return null
  // Split on the LAST hyphen so brand IDs that contain hyphens
  // (e.g. `aaif-staging`) still parse: `aaif-staging-admin` →
  // brand=`aaif-staging`, surface=`admin`.
  const lastDash = head.lastIndexOf('-')
  if (lastDash <= 0) return null
  const brand = head.slice(0, lastDash)
  const surface = head.slice(lastDash + 1)
  if (brand !== expectedBrand) return null
  if (surface === 'app') return { kind: 'portal', brand }
  // Other surfaces (admin/api/supabase/studio) are routed to non-portal
  // containers — the portal middleware should never see them. If it
  // does it's a routing leak; return unrecognized-surface.
  return { kind: 'unknown', reason: 'unrecognized-surface' }
}

export interface ParseHostOptions {
  rawHostname: string
  brandLocalDomain: string
  expectedBrand: string
  customDomainLookup: CustomDomainLookup
  // Disable legacy pattern recognition (used after the soak window is
  // over and step 9 of the migration plan removes dual-mode parsing).
  disableLegacyPattern?: boolean
}

/**
 * Parses a request hostname into a `ParsedHost`. The caller supplies a
 * `customDomainLookup` callback so the parser stays unit-testable
 * without a database connection.
 *
 * Order of dispatch:
 *  1. Normalize (lowercase, strip port, strip trailing dot, validate chars)
 *  2. Custom-domain check (existing path)
 *  3. New-pattern suffix-strip on `brandLocalDomain`
 *  4. Legacy `<brand>-<surface>.localhost` pattern (removed after soak)
 *  5. `{ kind: 'unknown' }`
 *
 * The brand returned in `portal` / `site` results MUST be checked against
 * `process.env.BRAND_ID` by the caller (defense-in-depth, §6.3 of the spec).
 */
export async function parseHost(opts: ParseHostOptions): Promise<ParsedHost> {
  const host = normalize(opts.rawHostname)
  if (!host) return { kind: 'unknown', reason: 'malformed' }

  // Custom-domain check runs first because a row in `custom_domains`
  // can shadow any pattern-based dispatch.
  const customDomainRow = await opts.customDomainLookup(host)
  if (customDomainRow) return { kind: 'custom-domain', record: customDomainRow }

  if (!opts.brandLocalDomain) {
    return { kind: 'unknown', reason: 'no-brand-domain' }
  }

  const labels = stripBrandSuffix(host, opts.brandLocalDomain)
  if (labels !== null) {
    const dispatched = dispatchNewPattern(labels, opts.expectedBrand)
    if (dispatched) return dispatched
    // Suffix matched but label set is not portal/site/sites — that's a
    // Traefik leak (admin/api/etc shouldn't reach portal middleware).
    return { kind: 'unknown', reason: 'unrecognized-surface' }
  }

  // Suffix didn't match the new pattern. Try legacy unless explicitly
  // disabled. Legacy hits log a warning so we can confirm the soak
  // window is empty before removing dual-mode parsing.
  if (!opts.disableLegacyPattern) {
    const legacy = dispatchLegacyPattern(host, opts.expectedBrand)
    if (legacy) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[host-parser] legacy_match', { legacy_match: true, host })
      }
      return legacy
    }
  }

  return { kind: 'unknown', reason: 'suffix-mismatch' }
}
