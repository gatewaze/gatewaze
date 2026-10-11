/**
 * Hand-maintained release history shown in the drawer's Change log sheet.
 *
 * Keep this in the same PR that bumps APP_VERSION / APP_BUILD_NUMBER for a
 * release, so the two never drift apart. There is no generator and no
 * backend table behind this — see spec issue #79, §5.4 and §7, for why it
 * started empty, and spec issue #84, §5.3, for the first real entry and the
 * rule for adding further ones: one entry per real, shipped release, never
 * invented ahead of time.
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
  {
    version: '0.1.0',
    build: 0, // fill in with the real APP_BUILD_NUMBER this release ships as
    date: '2026-10-09', // fill in with the real release date
    changes: [
      { kind: 'feature', text: 'Added app version, build number, and a Change log to the menu.' },
      { kind: 'fix', text: 'Change log now closes the menu first and displays correctly on top of it.' },
    ],
  },
];

/** Newest build first. */
export function changelogReleases(): ChangelogRelease[] {
  return [...CHANGELOG].sort((a, b) => b.build - a.build);
}
