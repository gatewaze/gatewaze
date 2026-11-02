/** Tab selection for the Change log sheet. Pure, so it can be tested without React Native. */

export type ChangelogTab = 'releases' | 'feedback';

/** The feedback tab exists only when the build has somewhere to send the member's reports list. */
export function availableChangelogTabs(historyPath: string | null): ChangelogTab[] {
  return historyPath ? ['releases', 'feedback'] : ['releases'];
}

export function resolveChangelogTab(requested: ChangelogTab, available: ChangelogTab[]): ChangelogTab {
  return available.includes(requested) ? requested : 'releases';
}
