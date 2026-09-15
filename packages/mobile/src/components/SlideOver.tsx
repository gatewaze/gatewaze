/**
 * A panel that slides in from the right and stops short of the left edge.
 *
 * The gap is the affordance. A panel that covers the screen edge to edge looks
 * like a new screen and people look for a back button; one that leaves a strip
 * of what it came from looks like something laid on top, and the way back is
 * obvious. Tap the strip or drag the panel to the right to dismiss.
 *
 * Used for anything that is a detour rather than a destination: swapping an
 * exercise mid-session, reading how a movement is performed without losing
 * your place in the set you are logging.
 */

import React, { useEffect, useMemo } from 'react';
import { PanResponder, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { Caps } from './primitives';
import { Easing } from 'react-native-reanimated';
import { useTheme, spacing, radius, motion, easing } from '../theme/tokens';

/** How much of what is underneath stays visible. */
const PEEK = 44;

const EASE = Easing.bezier(easing.x1, easing.y1, easing.x2, easing.y2);

export function SlideOver({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const panelWidth = width - PEEK;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, {
      duration: motion.drawer,
      easing: EASE,
    });
  }, [open, progress]);

  // Dragging the panel back to the right dismisses it. Only rightward drags
  // are claimed, so a list inside the panel still scrolls.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_e, g) => {
          progress.value = Math.min(1, Math.max(0, 1 - g.dx / panelWidth));
        },
        onPanResponderRelease: (_e, g) => {
          const dismissed = g.vx > 0.35 || progress.value < 0.6;
          progress.value = withTiming(dismissed ? 0 : 1, {
            duration: motion.drawer,
            easing: EASE,
          });
          if (dismissed) runOnJS(onClose)();
        },
      }),
    [panelWidth, progress, onClose]
  );

  const scrim = useAnimatedStyle(() => ({
    opacity: progress.value * 0.5,
    pointerEvents: progress.value > 0.01 ? 'auto' : 'none',
  }));

  const panel = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [panelWidth, 0]) }],
    pointerEvents: progress.value > 0.5 ? 'auto' : 'none',
  }));

  if (!open) return null;

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            width: panelWidth,
            backgroundColor: theme.background,
            borderColor: theme.border,
          },
          panel,
        ]}
        {...pan.panHandlers}
      >
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          <View style={styles.head}>
            {/* The grabber says "drag me" without a line of copy. */}
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            {title ? <Caps>{title}</Caps> : <View />}
            <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Close">
              <Icon name="close" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>
          {children}
        </SafeAreaView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { backgroundColor: '#000', zIndex: 20 },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    zIndex: 21,
    borderLeftWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    paddingHorizontal: spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  grabber: { width: 4, height: 36, borderRadius: 2 },
});
