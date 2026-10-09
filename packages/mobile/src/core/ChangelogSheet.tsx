/**
 * The drawer's Change log sheet.
 *
 * Follows BugReportSheet's overlay convention (a full-screen Animated.View
 * scrim with a Pressable to dismiss by tapping outside) rather than React
 * Native's Modal, which nothing else in this package uses.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassCircleButton } from '../components/GlassCircleButton';
import { Body, Caps, Caption, CardTitle } from '../components/primitives';
import { useTheme, radius, spacing } from '../theme/tokens';
import { changelogReleases } from './changelog';

export function ChangelogSheet({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const releases = changelogReleases();

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
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator>
            {releases.length === 0 ? (
              <Caption>Nothing recorded yet.</Caption>
            ) : (
              releases.map((r) => (
                <View key={`${r.version}:${r.build}`} style={styles.group}>
                  <Caps>{`v${r.version} · Build ${r.build} · ${r.date}`}</Caps>
                  {r.changes.map((c, i) => (
                    <Body key={i}>{`${c.kind === 'feature' ? '✦' : '✓'} ${c.text}`}</Body>
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
    justifyContent: 'center',
    padding: spacing.lg,
    zIndex: 41,
  },
  sheetWrap: { width: '100%', maxHeight: '80%' },
  sheet: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.lg },
  group: { gap: spacing.xs },
});
