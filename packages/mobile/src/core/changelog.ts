/**
 * Hand-maintained release history shown in the drawer's Change log sheet.
 *
 * Keep this in the same PR that bumps APP_VERSION / APP_BUILD_NUMBER for a
 * release, so the two never drift apart. There is no generator and no
 * backend table behind this — see spec issue #79, §5.4 and §7, for why it
 * started empty, and spec issue #84, §5.3, for the first real entry and the
 * rule for adding further ones: one entry per real, shipped release, never
 * invented ahead of time.
 *
 * Record the real APP_BUILD_NUMBER in the same PR that ships an entry. If
 * that number genuinely is not yet known at authoring time, use `null`,
 * never `0` — `0` is reserved by appInfo.ts to mean "the running app could
 * not read its own build," and a changelog entry is never the running app,
 * so `0` on a changelog entry can only ever be a leftover placeholder, not
 * a real value (see spec issue #93).
 */

export interface ChangelogChange {
  kind: 'feature' | 'fix';
  text: string;
}

export interface ChangelogRelease {
  /** e.g. '0.1.0', matches app.config.ts's APP_VERSION. */
  version: string;
  /** e.g. 1244, matches APP_BUILD_NUMBER. null if genuinely not yet known — never 0. */
  build: number | null;
  /** ISO date (yyyy-mm-dd) the build was released. */
  date: string;
  changes: ChangelogChange[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '0.1.0',
    build: null, // TODO(release approver): fill in the real APP_BUILD_NUMBER this build
                 // shipped as before merging — see §5.4 of the issue #93 spec. Do not guess;
                 // the issue that reported this defect explicitly could not confirm which
                 // build (1252 is an illustrative example, not a confirmed fact).
    date: '2026-10-09',
    changes: [
      { kind: 'feature', text: 'Added app version, build number, and a Change log to the menu.' },
      { kind: 'fix', text: 'Change log now closes the menu first and displays correctly on top of it.' },
    ],
  },
];

/** Newest build first. An entry with no recorded build sorts as oldest. */
export function changelogReleases(): ChangelogRelease[] {
  return [...CHANGELOG].sort((a, b) => (b.build ?? -1) - (a.build ?? -1));
}
