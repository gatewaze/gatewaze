/**
 * Hand-maintained release history shown in the drawer's Change log sheet.
 *
 * Keep this in the same PR that bumps APP_VERSION / APP_BUILD_NUMBER for a
 * release, so the two never drift apart. There is no generator and no
 * backend table behind this — see spec issue #79, §5.4 and §7, for why it
 * starts empty rather than backfilled with invented history.
 */

export interface ChangelogChange {
  kind: 'feature' | 'fix';
  text: string;
}

export interface ChangelogRelease {
  /** e.g. '0.1.0', matches app.config.ts's APP_VERSION. */
  version: string;
  /** e.g. 1244, matches APP_BUILD_NUMBER. */
  build: number;
  /** ISO date (yyyy-mm-dd) the build was released. */
  date: string;
  changes: ChangelogChange[];
}

export const CHANGELOG: ChangelogRelease[] = [
  // Seed entry — see spec issue #79, §5.4 and §7, for why this starts here
  // rather than with real history.
];

/** Newest build first. */
export function changelogReleases(): ChangelogRelease[] {
  return [...CHANGELOG].sort((a, b) => b.build - a.build);
}
