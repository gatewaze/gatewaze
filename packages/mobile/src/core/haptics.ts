/**
 * Haptics, as named intents rather than raw impact styles.
 *
 * Call sites say what happened ("a reply arrived", "the mic went on"), not how
 * hard to buzz. That is what keeps the app's feel consistent: changing what an
 * arriving reply feels like is one edit here, instead of a hunt through every
 * screen that happens to call impactAsync.
 *
 * ── EVERYTHING HERE IS FIRE AND FORGET ────────────────────────────────────
 *
 * No call is awaited and no failure is surfaced. A haptic is a courtesy; a
 * screen must never fail, stall, or log noise because the Taptic Engine was
 * busy. The module is also loaded lazily, so a build without expo-haptics
 * degrades to silence rather than crashing at import time — the same hazard
 * that took the app down when react-native-view-shot was imported eagerly.
 *
 * ── NOT AUDIBLE IN THE SIMULATOR ──────────────────────────────────────────
 *
 * The iOS Simulator has no Taptic Engine, so none of this can be verified
 * there. It is device-only behaviour and must be treated as unproven until
 * it has been felt on real hardware.
 */

import { Platform } from 'react-native';
import { motion } from '../theme/tokens';

type HapticsModule = typeof import('expo-haptics');

let cached: HapticsModule | null | undefined;

/** The native module, or null if it is unavailable for any reason. */
function haptics(): HapticsModule | null {
  if (cached !== undefined) return cached;
  try {
    // Required lazily and inside try/catch on purpose: see the header.
    cached = require('expo-haptics') as HapticsModule;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Android's vibrator is a different instrument, and mapping iOS's taptic
 * vocabulary onto it produces a buzz where iOS gives a tap. Until that is
 * designed properly, the haptics are iOS-only rather than badly ported.
 */
const enabled = Platform.OS === 'ios';

function impact(style: 'light' | 'medium' | 'heavy' | 'soft' | 'rigid') {
  if (!enabled) return;
  const h = haptics();
  if (!h) return;
  const map = {
    light: h.ImpactFeedbackStyle.Light,
    medium: h.ImpactFeedbackStyle.Medium,
    heavy: h.ImpactFeedbackStyle.Heavy,
    soft: h.ImpactFeedbackStyle.Soft,
    rigid: h.ImpactFeedbackStyle.Rigid,
  } as const;
  void h.impactAsync(map[style]).catch(() => undefined);
}

/**
 * How many times an arriving reply beats.
 *
 * The bubble's glow beats for as long as it is the newest message, which is
 * right for something you can look away from. A haptic cannot be looked away
 * from, so it stops: three beats is enough to register as a heartbeat rather
 * than a single buzz, and short enough that it never becomes nagging.
 */
const ARRIVAL_BEATS = 3;

/** One full lub-dub-and-rest, matching the glow exactly. */
const CYCLE_MS =
  motion.heartbeat.lubRise
  + motion.heartbeat.lubFall
  + motion.heartbeat.dubRise
  + motion.heartbeat.dubFall
  + motion.heartbeatRest;

/** Timers for the beat in progress, so a new reply replaces the old one. */
let beatTimers: ReturnType<typeof setTimeout>[] = [];

/** Stop any heartbeat still running. Safe to call at any time. */
export function stopHeartbeat() {
  for (const t of beatTimers) clearTimeout(t);
  beatTimers = [];
}

/**
 * A reply arrived: beat in time with the bubble's glow.
 *
 * The taps land on the two PEAKS of each lub-dub, so the beat in the hand and
 * the beat on screen are the same event. The dub is lighter than the lub, as
 * it is in the animation and in a real heartbeat.
 */
export function replyArrived() {
  if (!enabled) return;
  // A second reply restarts the beat rather than overlapping with the first,
  // which would land as an arrhythmia.
  stopHeartbeat();

  const lubAt = motion.heartbeat.lubRise;
  const dubAt = motion.heartbeat.lubRise + motion.heartbeat.lubFall + motion.heartbeat.dubRise;

  for (let beat = 0; beat < ARRIVAL_BEATS; beat += 1) {
    const start = beat * CYCLE_MS;
    beatTimers.push(setTimeout(() => impact('medium'), start + lubAt));
    beatTimers.push(setTimeout(() => impact('light'), start + dubAt));
  }
}

/**
 * A control that holds a state was switched ON — the mic, a capture mode.
 *
 * Rigid, because that is the firm click iOS uses for its own switches, and a
 * control that turns something on should feel more definite than one that
 * lets it go.
 */
export function toggleOn() {
  impact('rigid');
}

/** The same control switched OFF: softer, so the two are distinguishable. */
export function toggleOff() {
  impact('soft');
}

/** An ordinary button. Light, because most taps do not need announcing. */
export function tap() {
  impact('light');
}
