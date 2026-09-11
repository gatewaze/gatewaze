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
 *
 * ── WHAT THIS SHELL OWES THE PANELS ───────────────────────────────────────
 *
 * Panels stacked with nothing between them read as one long undifferentiated
 * column: a member could not see where food ended and training began. The
 * shell owns the separation, the rhythm and the date, so a panel author only
 * has to write their own content and every panel gets the same treatment. A
 * panel that drew its own card would be the one that looked wrong.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { LazyThunk } from '../components/LazyThunk';
import { Caption, Caps, Title } from '../components/primitives';
import { daySummaryPanels } from './registry';
import { useTheme, spacing, layout } from '../theme/tokens';

/** How far in from the right edge the drawer sits when fully open. */
export const SUMMARY_WIDTH = 320;

/** "Thursday, 11 September", in the member's own locale and zone. */
function today(): string {
  try {
    return new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  } catch {
    // Intl data can be absent on a stripped build; the heading still works.
    return '';
  }
}

export function SummaryDrawer({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const panels = daySummaryPanels();
  const date = today();

  return (
    <SafeAreaView
      style={[styles.panel, { width: SUMMARY_WIDTH, borderColor: theme.border }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Title>Today</Title>
          {date ? <Caption>{date}</Caption> : null}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
          style={[
            styles.close,
            { backgroundColor: theme.controlFill, borderColor: theme.controlBorder },
          ]}
        >
          <Icon name="close" size={19} color={theme.text} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {panels.length === 0 ? (
          <Caption>
            Nothing to summarise yet. Food and workouts appear here once those parts of
            the app are switched on for you.
          </Caption>
        ) : (
          panels.map((p, i) => (
            <View key={`${p.moduleId}:${p.key}`}>
              {/* A rule between panels, never above the first one. */}
              {i > 0 ? (
                <View style={[styles.divider, { backgroundColor: theme.border }]} />
              ) : null}
              <View style={styles.panelSlot}>
                <LazyThunk thunk={p.component} props={{ onNavigate: onClose }} />
              </View>
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
    paddingHorizontal: spacing.lg,
    paddingTop: 34,
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerText: { gap: 2 },
  close: {
    width: layout.tapTarget,
    height: layout.tapTarget,
    borderRadius: layout.tapTarget / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingBottom: spacing.xxl },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.lg },
  panelSlot: { gap: spacing.xs },
});
