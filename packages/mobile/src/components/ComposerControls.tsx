/**
 * The two round controls the composer is built from.
 *
 * They lived in CoachHome, which meant VoiceButton had to import from the
 * screen it is rendered inside and CoachBar imported them from a sibling
 * screen it otherwise has nothing to do with. Both are small, neither knows
 * anything about a thread, so they belong here with the other primitives.
 */

import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Icon } from './Icon';
import { useTheme, radius, motion, layout, easing as easingToken } from '../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function CircleButton({
  icon,
  onPress,
  onPressIn,
  onPressOut,
  active = false,
  disabled = false,
  prominent = false,
  busy = false,
}: {
  icon: string;
  onPress: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Replaces the glyph with a spinner. The button stays put and stays sized. */
  busy?: boolean;
  /**
   * Draws the button filled rather than as a faint control. Used for voice
   * input, which we want people to reach for rather than overlook.
   */
  prominent?: boolean;
}) {
  const theme = useTheme();
  const filled = active || prominent;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      style={[
        styles.circle,
        {
          backgroundColor: filled ? theme.invert : theme.controlFill,
          borderColor: filled ? theme.invert : theme.controlBorder,
          // A prominent control keeps its weight: dimming it to 35% would
          // defeat the point of making it stand out.
          opacity: disabled && !prominent ? 0.35 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={filled ? theme.onInvert : theme.text} />
      ) : (
        <Icon name={icon} size={19} color={filled ? theme.onInvert : theme.text} />
      )}
    </Pressable>
  );
}

/**
 * A mode pill. Inactive pills are icon-only; the active pill fills and its
 * label expands, animated with the shared easing token (design: mode
 * switch, .3s, label max-width 0 to 64px plus opacity).
 */
export function ModePill({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: motion.quick,
      easing: Easing.bezier(easingToken.x1, easingToken.y1, easingToken.x2, easingToken.y2),
    });
  }, [active, progress]);

  const labelStyle = useAnimatedStyle(() => ({
    maxWidth: progress.value * 90,
    opacity: progress.value,
    marginLeft: progress.value * 6,
  }));

  const pillStyle = useAnimatedStyle(() => ({
    paddingHorizontal: 10 + progress.value * 4,
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      // Draws at modePillHeight, but the target reaches the HIG's 44.
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      style={[
        styles.pill,
        active ? styles.pillActive : null,
        { backgroundColor: active ? theme.invert : 'transparent' },
        pillStyle,
      ]}
    >
      <Icon name={icon} size={18} color={active ? theme.onInvert : theme.textMuted} />
      <Animated.View style={[styles.pillLabel, labelStyle]}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 13, fontWeight: '700', color: theme.onInvert }}
        >
          {label}
        </Text>
      </Animated.View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: layout.tapTarget,
    height: layout.tapTarget,
    borderRadius: layout.tapTarget / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    height: layout.modePillHeight,
    justifyContent: 'center',
  },
  pillActive: { flex: 1 },
  pillLabel: { overflow: 'hidden' },
});
