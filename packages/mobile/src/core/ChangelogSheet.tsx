/**
 * The drawer's Change log sheet.
 *
 * Follows BugReportSheet's overlay convention (a full-screen Animated.View
 * scrim with a Pressable to dismiss by tapping outside) rather than React
 * Native's Modal, which nothing else in this package uses.
 *
 * When the build's feedback-owning module declares a feedback history, a
 * second "My feedback" tab lists the member's past reports. Otherwise the
 * sheet is the single release list it always was.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassCircleButton } from '../components/GlassCircleButton';
import { LazyThunk } from '../components/LazyThunk';
import { Body, Button, Caps, Caption, CardTitle } from '../components/primitives';
import { useTheme, radius, spacing } from '../theme/tokens';
import { changelogReleases } from './changelog';
import { formatVersionBuild } from './appInfo';
import { feedbackHistoryList, feedbackHistoryPath } from './registry';
import { availableChangelogTabs, resolveChangelogTab, type ChangelogTab } from './changelog-tabs';

const TAB_LABELS: Record<ChangelogTab, string> = { releases: 'Releases', feedback: 'My feedback' };

export function ChangelogSheet({
  onClose,
  onNavigate,
  initialTab = 'releases',
}: {
  onClose: () => void;
  /** Close the sheet and push `path`. Used by the My feedback tab. */
  onNavigate: (path: string) => void;
  initialTab?: ChangelogTab;
}) {
  const theme = useTheme();
  const releases = changelogReleases();
  const historyPath = feedbackHistoryPath();
  const historyList = feedbackHistoryList();
  const tabs = availableChangelogTabs(historyPath);
  const [requestedTab, setTab] = useState<ChangelogTab>(initialTab);
  const tab = resolveChangelogTab(requestedTab, tabs);

  return (
    <Animated.View entering={FadeIn.duration(150)} style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View entering={FadeInDown.duration(200)} style={styles.sheetWrap}>
        <SafeAreaView
          edges={['top', 'bottom']}
          style={[styles.sheet, { backgroundColor: theme.sheet, borderColor: theme.border }]}
        >
          <View style={styles.header}>
            <CardTitle>Change log</CardTitle>
            <GlassCircleButton icon="close" onPress={onClose} accessibilityLabel="Close change log" />
          </View>
          {tabs.length > 1 ? (
            <View style={styles.tabs} accessibilityRole="tablist">
              {tabs.map((id) => {
                const selected = id === tab;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setTab(id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    style={[
                      styles.tab,
                      { borderColor: theme.border },
                      selected ? { backgroundColor: theme.buttonFill, borderColor: theme.buttonFill } : null,
                    ]}
                  >
                    <Caps style={{ color: selected ? theme.buttonText : theme.textSecondary }}>
                      {TAB_LABELS[id]}
                    </Caps>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator>
            {tab === 'feedback' ? (
              historyList ? (
                <LazyThunk thunk={historyList} props={{ onOpen: onNavigate }} />
              ) : (
                <>
                  <Caption>Bug reports and feature requests you have sent, and the replies to them.</Caption>
                  <Button title="Open My feedback" onPress={() => onNavigate(historyPath!)} />
                </>
              )
            ) : releases.length === 0 ? (
              <Caption>Nothing recorded yet.</Caption>
            ) : (
              releases.map((r) => (
                <View key={`${r.version}:${r.build ?? 'unknown'}`} style={styles.group}>
                  <Caps>{`v${formatVersionBuild(r.version, r.build)} · ${r.date}`}</Caps>
                  {r.changes.map((c, i) => (
                    <View key={i} style={styles.change}>
                      <Body>{`${c.kind === 'feature' ? '✦' : '✓'} ${c.text}`}</Body>
                      {c.reporter ? <Caption>{`Reported by ${c.reporter}`}</Caption> : null}
                    </View>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-start',
    padding: spacing.lg,
    zIndex: 41,
  },
  sheetWrap: { width: '100%', height: '80%' },
  sheet: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden', flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  tabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  scroll: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.lg },
  group: { gap: spacing.xs },
  change: { gap: 2 },
});
