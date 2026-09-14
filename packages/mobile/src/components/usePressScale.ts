/**
 * The press that grows under your finger.
 *
 * ── WHAT iOS ACTUALLY DOES, AND WHAT IT DOES NOT ──────────────────────────
 *
 * The behaviour the operator asked for is the one iOS 26 controls have: press
 * and the control swells slightly and STAYS swollen while your finger is down,
 * rather than flashing and springing back. It returns when you lift.
 *
 * So this is not an "animate on tap" helper. `scale` is driven by the press
 * STATE, not by the tap event, which is the whole difference: a tap animation
 * has a duration of its own and finishes whether or not you are still touching
 * it, and a long press then looks identical to a quick one.
 *
 * ── WHY SPRINGS AND NOT TIMING ────────────────────────────────────────────
 *
 * A press has no natural duration — it ends when the finger lifts, which might
 * be in 40ms or two seconds. Anything driven by `withTiming` has to pick a
 * duration and will be interrupted mid-flight by the release, which produces a
 * visible jump from wherever it had reached. A spring has no target time: it is
 * always heading somewhere from wherever it currently is, so interrupting it is
 * the normal case rather than a glitch. That is what makes sliding a finger
 * across several controls look continuous.
 *
 * Damping is high and mass low: this should feel immediate and firm, not
 * bouncy. A control that wobbles reads as a toy.
 *
 * ── IT RUNS ON THE NATIVE THREAD ──────────────────────────────────────────
 *
 * The shared value is written from the gesture and read in a worklet, so no
 * JavaScript runs per frame and the animation does not stutter while the app
 * is busy — which is exactly when a press most needs to feel responsive.
 */

import { useCallback } from 'react';
import {
  ReduceMotion,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

/** Firm and quick. Tuned to settle without overshooting visibly. */
export const PRESS_SPRING = {
  damping: 18,
  stiffness: 320,
  mass: 0.6,
  overshootClamping: false,
  /**
   * Runs even with the system's Reduce Motion enabled — deliberately.
   *
   * Reanimated honours Reduce Motion by default, which makes springs JUMP to
   * their end state. A 6% press-scale that jumps is imperceptible, so on any
   * phone with the setting on (the operator's included) every button appeared
   * to have lost its press behaviour entirely. Press feedback is FUNCTIONAL —
   * it tells the finger it landed — and Apple's own controls keep theirs under
   * Reduce Motion. Decorative motion (the ambient mesh drift) still honours
   * the setting; this is the line between the two.
   */
  reduceMotion: ReduceMotion.Never,
} as const;

export interface PressScale {
  /** Spread onto an Animated view's style. */
  style: { transform: { scale: number }[] };
  onPressIn: () => void;
  onPressOut: () => void;
  /** The raw value, for a parent that drives several children (the pill track). */
  pressed: SharedValue<number>;
}

/**
 * @param to How large at full press. 1.06 on a small round control reads as
 *   firm; much more and it looks like it is being inflated.
 */
export function usePressScale(to = 1.06): PressScale {
  const pressed = useSharedValue(0);

  const onPressIn = useCallback(() => {
    pressed.value = withSpring(1, PRESS_SPRING);
  }, [pressed]);

  const onPressOut = useCallback(() => {
    pressed.value = withSpring(0, PRESS_SPRING);
  }, [pressed]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pressed.value * (to - 1) }],
  }));

  return { style, onPressIn, onPressOut, pressed };
}
