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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { LazyThunk } from '../components/LazyThunk';
import { Caps, Caption } from '../components/primitives';
import { daySummaryPanels } from './registry';
import { useTheme, spacing } from '../theme/tokens';

/** How far in from the right edge the drawer sits when fully open. */
export const SUMMARY_WIDTH = 320;

export function SummaryDrawer({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const panels = daySummaryPanels();

  return (
    <SafeAreaView
      style={[styles.panel, { width: SUMMARY_WIDTH, borderColor: theme.border }]}
      edges={['top', 'bottom']}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Pinned to the right edge, beneath the surface. No background of its own:
  // the host paints the ground behind both drawers so they match.
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingTop: 34,
    paddingBottom: 20,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelSlot: { gap: spacing.xs },
});
