/**
 * One exchange in the thread, displaced slightly as the thread is scrolled so
 * the spacing travels through it as a wave.
 *
 * ── WHY A TRANSFORM AND NOT A GAP ─────────────────────────────────────────
 *
 * The first version animated the container's `gap`. It looked right and ran
 * badly: `gap` is a LAYOUT property, so every scroll frame laid the whole
 * thread out again, and the longer the conversation the worse it got. A
 * transform is handled by the compositor instead, so the cost per frame does
 * not grow with the number of messages.
 *
 * ── WHY A SINE, AND WHY IT COSTS NOTHING OFF SCREEN ───────────────────────
 *
 * What is wanted is a WAVE: gaps opening at one end of the screen and closing
 * at the other, travelling as the thread moves. The gap between two rows is
 * set by the DIFFERENCE in their displacement, so a displacement that curves
 * across the viewport is what produces a varying gap — a straight ramp would
 * move everything by the same relative amount and change nothing.
 *
 * sin gives that curve, and one property of it does the rest of the work for
 * free: it is zero at both ends of the window. A row above the viewport and a
 * row below it are both displaced by exactly nothing, so the effect is
 * confined to what is on screen without needing to know which rows those are,
 * and there is no seam at the boundary because the motion has already faded
 * to zero by the time a row leaves.
 */

import React, { useCallback } from 'react';
import type { LayoutChangeEvent, ViewStyle, StyleProp } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * The most a row is displaced, in points, at full scroll speed.
 *
 * The visible effect on the GAP is the difference between neighbours, which
 * is roughly a third of this for a message about an eighth of the screen
 * tall — so the number here is deliberately larger than the gap change it
 * produces. The run has been 14 (about 5pt of gap change), then 28 (about
 * 10), now 52 (about 18), each time because the last was too easy to miss.
 */
const WAVE_AMPLITUDE = 52;

export function ThreadRow({
  drift,
  scrollY,
  viewportH,
  style,
  children,
}: {
  /** 0 at rest, up to 1 at full scroll speed. */
  drift: SharedValue<number>;
  /** Current scroll offset of the thread. */
  scrollY: SharedValue<number>;
  /** Height of the window onto the thread. */
  viewportH: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  /**
   * Where this row sits in the thread's content, measured once when it lays
   * out. Cheap: layout already happened, this only records the result.
   */
  const top = useSharedValue(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      top.value = e.nativeEvent.layout.y;
    },
    [top]
  );

  const animated = useAnimatedStyle(() => {
    const h = viewportH.value;
    // Before the first scroll event there is no window to be inside.
    if (h <= 0 || drift.value === 0) return { transform: [{ translateY: 0 }] };

    // Position in the window: 0 at the top edge, 1 at the bottom.
    const t = (top.value - scrollY.value) / h;
    // Off screen either way, the sine below would be at or past its zero, so
    // returning early just skips the arithmetic for rows nobody can see.
    if (t < 0 || t > 1) return { transform: [{ translateY: 0 }] };

    return {
      transform: [{ translateY: drift.value * WAVE_AMPLITUDE * Math.sin(Math.PI * t) }],
    };
  });

  return (
    <Animated.View style={[style, animated]} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}
