/**
 * Lightweight semver comparison utilities.
 * Handles MAJOR.MINOR.PATCH format (no pre-release or build metadata).
 */

function parseSemver(version: string): [number, number, number] {
  const parts = version.replace(/^v/, '').split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Compare two semver strings.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);

  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1;
  if (aMin !== bMin) return aMin > bMin ? 1 : -1;
  if (aPat !== bPat) return aPat > bPat ? 1 : -1;
  return 0;
}

/**
 * Returns true if `source` version is newer than `installed` version.
 */
export function isNewerVersion(source: string, installed: string): boolean {
  return compareSemver(source, installed) === 1;
}
