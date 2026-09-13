/**
 * Notifications: permission, a token, and what happens on a tap.
 *
 * This knows nothing about health. It does not decide whether to notify, when,
 * or about what — all of that is evaluated on the server, because the data the
 * decisions need is not on the device and the most useful prompts fire while
 * the app is closed. See spec-health-notifications.md §3.3.
 *
 * The device's whole job is: ask, hold a token, and hand a tap to the coach.
 *
 * ── A TAP GOES TO THE COACH, NOT TO A SCREEN ──────────────────────────────
 *
 * `requestCoachHandoff` already does "leave something pending, move to the
 * coach, let it pick this up on focus", and it already survives the app being
 * cold-started by the tap, which a direct navigation would not. The coach
 * renders the prompt through the module's own thread card, so acknowledging a
 * medication reminder lands on the take/skip card health-meds already has.
 *
 * ── NOTHING IN A NOTIFICATION BODY IS HEALTH CONTENT ──────────────────────
 *
 * A lock screen is read by whoever is holding the phone. The body says a
 * reminder is waiting and nothing else; the content is behind the tap, inside
 * the app, behind whatever the device locks with. The server composes the body
 * and this file does not second-guess it, but the rule is written here because
 * this is the file an engineer reads when adding a notification.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { requestCoachHandoff } from '../core/coachHandoff';

/** What the server puts in `data`. Anything else is ignored. */
export interface NoticePayload {
  noticeId: string;
  sendId: string;
  /** The module's own card payload, passed through untouched. */
  payload?: unknown;
}

/**
 * A notification arriving while the app is open does NOT interrupt.
 *
 * The member is already looking at the thing it would be telling them about.
 * An alert over the top of the coach mid-sentence is the behaviour that gets an
 * app muted, and the prompt is not lost: it is on the server and the coach
 * shows it on next focus regardless.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function isAvailable(): boolean {
  // Simulators cannot receive a push token; treating that as "no device" keeps
  // the sign-in path quiet rather than erroring on every launch in development.
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Ask, once, and report what happened.
 *
 * iOS shows its permission sheet exactly once per install. A member who says no
 * can only change it in Settings, so nothing here retries or nags: `denied` is
 * an answer and the caller's job is to stop asking.
 */
export async function requestPermission(): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!isAvailable()) return 'unavailable';
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return 'granted';
  if (!existing.canAskAgain) return 'denied';
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted ? 'granted' : 'denied';
}

/** Whether permission currently stands. Cheap; safe to call on resume. */
export async function hasPermission(): Promise<boolean> {
  if (!isAvailable()) return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

/**
 * The Expo push token for this device, or null.
 *
 * Null is an ordinary outcome and not an error: a simulator, a denied
 * permission, or a device with no network at launch. The caller registers a
 * token when there is one and otherwise does nothing, and a person with no
 * usable device is simply never evaluated server-side.
 */
export async function pushToken(projectId?: string): Promise<string | null> {
  if (!isAvailable()) return null;
  if (!(await hasPermission())) return null;
  try {
    const res = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return res?.data ?? null;
  } catch {
    // No network, or a project id the push service will not accept. Neither is
    // worth surfacing: notifications are an enhancement and the app works.
    return null;
  }
}

function toNotice(data: unknown): NoticePayload | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.noticeId !== 'string' || typeof d.sendId !== 'string') return null;
  return { noticeId: d.noticeId, sendId: d.sendId, payload: d.payload };
}

/**
 * Route taps to the coach, for as long as the app lives.
 *
 * Covers both cases, which are genuinely different:
 *
 *   - the app was running and the member tapped: the listener fires;
 *   - the app was closed and the tap LAUNCHED it: the listener never fires, and
 *     the tap is only visible through getLastNotificationResponseAsync.
 *
 * Missing the second is the classic version of this bug, and it is the case
 * that matters most: a notification is at its most useful when the app is shut.
 */
export function onNoticeTapped(handler: (notice: NoticePayload) => void): () => void {
  const deliver = (response: Notifications.NotificationResponse | null) => {
    const notice = toNotice(response?.notification?.request?.content?.data);
    if (notice) handler(notice);
  };

  // The tap that launched the app, if there was one.
  void Notifications.getLastNotificationResponseAsync().then(deliver).catch(() => undefined);

  const sub = Notifications.addNotificationResponseReceivedListener(deliver);
  return () => sub.remove();
}

/**
 * The default handler: hand the prompt to the coach.
 *
 * Separate from `onNoticeTapped` so a caller can do something else with a tap
 * without reimplementing the listener.
 */
export function handOffToCoach(notice: NoticePayload): void {
  requestCoachHandoff({ kind: 'notice', notice });
}
