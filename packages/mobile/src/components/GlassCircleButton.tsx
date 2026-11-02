/**
 * A round chrome control on real glass.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The menu button looked like two different controls depending on the screen.
 * On a pushed screen it is a navigation-bar button item, and on iOS 26 the
 * system gives those a genuine Liquid Glass capsule: it blurs what is behind
 * it, adapts to light and dark, and honours Reduce Transparency. On the coach
 * home there is no navigation bar, so the button was drawn by hand as a circle
 * with `rgba(255,255,255,0.16)` in it — a flat fill imitating glass, with
 * nothing actually blurred behind it.
 *
 * Side by side the hand-made one looks thin and slightly small, which is what
 * the operator noticed. This gives every round chrome control the same real
 * material by routing it through GlassPanel, which already picks Liquid Glass,
 * then expo-blur, then a token fill, depending on what the device can do.
 *
 * Sized to the HIG's 44pt, which is also about the size of the system capsule
 * the navigation bar draws, so the two now match rather than nearly match.
 *
 * ── PRESS FEEDBACK ────────────────────────────────────────────────────────
 *
 * Pressing fills the glass, exactly as the system capsule does on a navigation
 * bar. Without a fill the glass brightens under the finger and the light glyph
 * brightens with it, so the control appears to go blank at the moment it is
 * touched. The fill is kept, but it fades in and out over a short fixed time
 * instead of switching instantly, and it is translucent so the glass still
 * shows through.
 *
 * An SF Symbol's colour cannot be animated from a worklet, so the glyph is
 * drawn twice, once in the rest colour and once in the pressed colour, and the
 * two layers cross-fade. The same technique cross-fades the glyph when `icon`
 * changes (menu to close and back).
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { GlassPanel } from './GlassPanel';
import { Icon } from './Icon';
import { withAlpha } from './primitives';
import {
  PRESS_FILL_ALPHA,
  PRESS_FILL_IN_MS,
  PRESS_FILL_OUT_MS,
  SWAP_MS,
  pressLayerOpacities,
} from './glassPress';
import { usePressScale } from './usePressScale';
import { useTheme, layout, easing as easingToken } from '../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const EASE = Easing.bezier(easingToken.x1, easingToken.y1, easingToken.x2, easingToken.y2);

export function GlassCircleButton({
  icon,
  onPress,
  size = layout.tapTarget,
  iconSize = 19,
  color,
  accessibilityLabel,
  children,
}: {
  icon: string;
  onPress: () => void;
  size?: number;
  iconSize?: number;
  color?: string;
  accessibilityLabel?: string;
  /** Anything drawn over the button, e.g. the outbox's failure dot. */
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const press = usePressScale(1.08);
  const fill = useSharedValue(0);
  const swap = useSharedValue(1);
  const prevIcon = useRef(icon);
  const [outgoing, setOutgoing] = useState<string | null>(null);

  // Layout effect so the new glyph never paints once at full opacity before
  // the cross-fade starts from zero.
  useLayoutEffect(() => {
    if (prevIcon.current === icon) return;
    setOutgoing(prevIcon.current);
    prevIcon.current = icon;
    swap.value = 0;
    swap.value = withTiming(1, { duration: SWAP_MS, easing: EASE }, (finished) => {
      if (finished) runOnJS(setOutgoing)(null);
    });
  }, [icon, swap]);

  useEffect(() => () => { swap.value = 1; }, [swap]);

  // Press feedback is functional, so it runs even with Reduce Motion on, as
  // the press scale does. The icon swap is decorative and honours the setting.
  const onPressIn = () => {
    press.onPressIn();
    fill.value = withTiming(1, {
      duration: PRESS_FILL_IN_MS,
      easing: EASE,
      reduceMotion: ReduceMotion.Never,
    });
  };
  const onPressOut = () => {
    press.onPressOut();
    fill.value = withTiming(0, {
      duration: PRESS_FILL_OUT_MS,
      easing: EASE,
      reduceMotion: ReduceMotion.Never,
    });
  };

  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: pressLayerOpacities(fill.value).rest }));
  const pressedStyle = useAnimatedStyle(() => ({ opacity: pressLayerOpacities(fill.value).pressed }));
  const outgoingStyle = useAnimatedStyle(() => ({ opacity: 1 - swap.value }));
  const incomingStyle = useAnimatedStyle(() => ({ opacity: swap.value }));

  const restColor = color ?? theme.text;

  // Two stacked glyph layers (rest colour, pressed colour) for one icon name.
  const glyph = (name: string) => (
    <>
      <Animated.View style={[styles.layer, restStyle]}>
        <Icon name={name} size={iconSize} color={restColor} />
      </Animated.View>
      <Animated.View style={[styles.layer, pressedStyle]}>
        <Icon name={name} size={iconSize} color={theme.onInvert} />
      </Animated.View>
    </>
  );

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={12}
      style={press.style}
    >
      {/* The glass is the panel, not the Pressable: GlassView composites its
          own material and cannot be given a background of ours without
          defeating the point of it. */}
      <GlassPanel radius={size / 2} variant="clear">
        <View style={[styles.inner, { width: size, height: size }]}>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: withAlpha(theme.invert, PRESS_FILL_ALPHA) },
              fillStyle,
            ]}
          />
          {/* Hidden from screen readers: the Pressable carries the label. */}
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {outgoing ? (
              <>
                <Animated.View style={[StyleSheet.absoluteFill, outgoingStyle]}>
                  {glyph(outgoing)}
                </Animated.View>
                <Animated.View style={[StyleSheet.absoluteFill, incomingStyle]}>
                  {glyph(icon)}
                </Animated.View>
              </>
            ) : (
              glyph(icon)
            )}
          </View>
          {children}
        </View>
      </GlassPanel>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  inner: { alignItems: 'center', justifyContent: 'center' },
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
