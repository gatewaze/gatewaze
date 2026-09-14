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
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { GlassPanel } from './GlassPanel';
import { Icon } from './Icon';
import { usePressScale } from './usePressScale';
import { useTheme, layout } from '../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  /**
   * Held, in React state rather than only as a shared value.
   *
   * The scale animates on the native thread and never needs a re-render, but
   * the GLYPH's colour does: it has to swap from light to dark while the
   * button is down, and a colour cannot be driven from a worklet through an
   * SF Symbol. Two representations of one gesture, each where it belongs.
   */
  const [held, setHeld] = useState(false);

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => { press.onPressIn(); setHeld(true); }}
      onPressOut={() => { press.onPressOut(); setHeld(false); }}
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
          {/* Pressing fills the glass, exactly as the system capsule does on a
              navigation bar. Without it the button brightens under the finger
              and the white glyph brightens with it, so the control appears to
              go blank at the moment it is touched. */}
          {held ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.invert }]} />
          ) : null}
          <Icon
            name={icon}
            size={iconSize}
            // Dark on the filled state, light on the glass.
            color={held ? theme.onInvert : color ?? theme.text}
          />
          {children}
        </View>
      </GlassPanel>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  inner: { alignItems: 'center', justifyContent: 'center' },
});
