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
  /**
   * Which thread card renders the prompt. Not always the notice's own id — a
   * medication reminder lands on the card health-meds already has.
   */
  cardKind?: string;
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
 * The device's push token, or null.
 *
 * Null is an ordinary outcome and not an error: a simulator, a denied
 * permission, or a device with no network at launch. A caller that needs to
 * TELL somebody why should use pushTokenResult instead, which carries the
 * reason.
 */
export async function pushToken(): Promise<PushToken | null> {
  const res = await pushTokenResult();
  return res.ok ? res.token : null;
}

/** A device's push token and which service it belongs to. */
export interface PushToken {
  value: string;
  /** 'apns' on iOS, 'fcm' on Android. The server sends by this. */
  kind: 'apns' | 'fcm';
}

export type PushTokenResult =
  | { ok: true; token: PushToken }
  | { ok: false; reason: string };

/**
 * The device's NATIVE push token, and why it failed if it did.
 *
 * ── WHY NOT AN EXPO PUSH TOKEN ────────────────────────────────────────────
 *
 * `getExpoPushTokenAsync` needs an EAS projectId, which it infers from the
 * manifest. This app is built locally with xcodebuild and has no EAS project,
 * so it throws ERR_NOTIFICATIONS_NO_EXPERIENCE_ID every time — "No projectId
 * found ... in bare workflow you have to pass it in yourself."
 *
 * The native token needs no Expo project at all, and the server already holds
 * the APNs key it is sent with. It is also the better answer on its own terms:
 * a health prompt does not travel through a third-party relay to reach the
 * phone, which is one fewer party holding a device identifier for an app whose
 * notifications are about somebody's medication.
 *
 * ── AND WHY THIS RETURNS A REASON ─────────────────────────────────────────
 *
 * The old version caught everything and returned null, so the settings screen
 * could only ever say "this device could not be registered" — the same
 * sentence for a simulator, a revoked permission, a missing project id and a
 * dead network. The caller now gets something it can tell a person.
 */
export async function pushTokenResult(): Promise<PushTokenResult> {
  if (!isAvailable()) return { ok: false, reason: 'This device cannot receive notifications.' };
  if (!(await hasPermission())) {
    return { ok: false, reason: 'Notifications are turned off for this app in your device Settings.' };
  }
  try {
    const res = await Notifications.getDevicePushTokenAsync();
    const value = typeof res?.data === 'string' ? res.data : null;
    if (!value) {
      return {
        ok: false,
        // A simulator reaches here: it registers but is handed nothing.
        reason: 'This device was not given a push token. A simulator cannot receive notifications.',
      };
    }
    return { ok: true, token: { value, kind: Platform.OS === 'ios' ? 'apns' : 'fcm' } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Could not register this device: ${message}` };
  }
}

function toNotice(data: unknown): NoticePayload | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.noticeId !== 'string' || typeof d.sendId !== 'string') return null;
  return {
    noticeId: d.noticeId,
    sendId: d.sendId,
    cardKind: typeof d.cardKind === 'string' ? d.cardKind : undefined,
    payload: d.payload,
  };
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
