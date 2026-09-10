/**
 * The day summary drawer: swipe in from the right edge on any screen.
 *
 * A quick read of the day and the two fastest ways to add to it. The left
 * drawer answers "where do I want to go"; this one answers "how am I doing
 * today", which is the question a member actually opens the app with.
 *
 * The core knows nothing about food or workouts. Each module contributes its
 * own panel through `daySummary` in its mobile manifest and talks only to its
 * own API, the same arrangement as thread cards. A build without health-diet
 * simply has no macros panel rather than a broken one.
 *
 * The camera and barcode buttons come from the food panel rather than from
 * here. The core does not own those screens and cannot name them without
 * knowing which module is installed, so each panel renders its own actions
 * and closes the drawer through the `onNavigate` prop it is given.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, interpolate } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { LazyThunk } from '../components/LazyThunk';
import { Caps, Caption } from '../components/primitives';
import { daySummaryPanels } from './registry';
import { useTheme, spacing } from '../theme/tokens';

/** How far in from the right edge the drawer sits when fully open. */
export const SUMMARY_WIDTH = 320;

export function SummaryDrawer({
  progress,
  onClose,
}: {
  /** 0 closed, 1 open. Shared with the gesture that drives it. */
  progress: SharedValue<number>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const panels = daySummaryPanels();

  const scrim = useAnimatedStyle(() => ({
    opacity: progress.value * 0.6,
    // Nothing behind the drawer should take a touch while it is open, and a
    // closed drawer's scrim must not swallow taps meant for the screen.
    pointerEvents: progress.value > 0.01 ? 'auto' : 'none',
  }));

  const panel = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [SUMMARY_WIDTH, 0]) }],
  }));

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close the day summary" />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            width: SUMMARY_WIDTH,
            // Deliberately darker than the app's own ground, so the drawer
            // reads as sitting over the screen rather than as part of it.
            backgroundColor: theme.void,
            borderColor: theme.border,
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.md,
          },
          panel,
        ]}
      >
        <View style={styles.header}>
          <Caps>Today</Caps>
          <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={20} color={theme.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.fill}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          {panels.length === 0 ? (
            <Caption>
              Nothing to summarise yet. Food and workouts appear here once those parts of
              the app are switched on for you.
            </Caption>
          ) : (
            panels.map((p) => (
              <View key={`${p.moduleId}:${p.key}`} style={styles.panelSlot}>
                <LazyThunk thunk={p.component} props={{ onNavigate: onClose }} />
              </View>
            ))
          )}
        </ScrollView>

      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { backgroundColor: '#000' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    borderLeftWidth: 1,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelSlot: { gap: spacing.xs },
});
