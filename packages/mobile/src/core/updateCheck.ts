/**
 * Checks whether a newer build than this one is known to be available
 * (issue #94). The device knows its own build (appInfo.ts) but not whether
 * a newer one has shipped — that only exists on the release pipeline, so
 * this is a live round trip to GET /api/app-releases/latest rather than
 * anything baked into the bundle.
 */

import { Platform } from 'react-native';
import { apiFetch } from './http';
import { appBuildNumber } from './appInfo';

export interface AvailableUpdate {
  version: string;
  build: number;
}

interface LatestReleaseResponse {
  version: string;
  build: number;
}

/**
 * Null when no update is known to be available — either because the
 * installed build is already current, or because nothing could be
 * determined (no network, no row recorded yet, unsupported platform).
 * Absence of evidence is not evidence of an update; the safe direction
 * to be wrong is silence, the same rule appBuildNumber() already takes
 * for an unreadable build number.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;
  if (!platform) return null;
  try {
    const res = (await apiFetch(`/api/app-releases/latest?platform=${platform}`)) as LatestReleaseResponse | null;
    if (!res) return null;
    return res.build > appBuildNumber() ? { version: res.version, build: res.build } : null;
  } catch {
    // Offline, server error, or anything else — say nothing rather than
    // nag on a guess.
    return null;
  }
}
