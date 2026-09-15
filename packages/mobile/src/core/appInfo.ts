/**
 * What build of the app this is.
 *
 * The core owns app identity. A module that reached for `expo-constants`
 * itself would be reading the build number from a package outside the module
 * dependency allowlist, and the allowlist exists so that adding to a module's
 * dependency surface is a deliberate platform decision rather than an import.
 *
 * ── WHY A MODULE WANTS THIS AT ALL ────────────────────────────────────────
 *
 * health-notify registers a push token against a build number, because the
 * server knows a person's notices but not which app version they are running.
 * A build without notification support has no tap handler, so a notification it
 * received would open the app and do nothing — spending the member's attention
 * and teaching them the prompts are useless.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * The native build number, or 0 when it cannot be read.
 *
 * Zero is deliberate rather than a guess. The server refuses to send to a build
 * below its minimum, so an unreadable build means "do not send to me", which is
 * the safe direction to be wrong in. Reporting a high number on a build that
 * cannot handle a tap is the failure worth avoiding.
 */
export function appBuildNumber(): number {
  const raw = Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : Constants.expoConfig?.android?.versionCode;
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** The marketing version, e.g. '1.4.0'. 'dev' when running unbuilt. */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? 'dev';
}

/**
 * The IANA timezone this device is set to.
 *
 * Here because nothing in the health family records one and the device is the
 * only thing that actually knows. Every quiet hour and habit window is computed
 * from it, so a member who travels is reached on the clock they are living by.
 */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
