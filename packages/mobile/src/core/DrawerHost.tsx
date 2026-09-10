/**
 * The slide-out drawer host (spec-mobile-coach-rebrand.md).
 *
 * Custom by decision: iOS has no native drawer, and this is the pattern
 * mobile AI apps use. Opening slides the active surface right and scales
 * it down, revealing the menu underneath.
 *
 * Entries come from module `tabs` contributions, grouped by `section` so
 * the list stays readable as the module set grows. Recents and New chat
 * appear when a module owns the coach; Settings is pinned at the bottom.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { withAlpha } from '../components/primitives';
import { useFocusEffect, useRouter } from 'expo-router';
import { Icon } from '../components/Icon';
import { LazyThunk } from '../components/LazyThunk';
import { AmbientBackground } from '../components/AmbientBackground';
import { Button, Caps, EmptyState } from '../components/primitives';
import { coachProvider, drawerSections } from './registry';
import { onOutboxChange, outboxCounts } from './outbox';
import { consumeOpenDrawerRequest } from './drawerSignal';
import { useSession } from './auth/session';
import { CoachHome } from './CoachHome';
import { config } from './config';
import {
  useTheme,
  drawer as drawerTokens,
  easing,
  headerFadeLocations,
  headerHeight,
  layout,
  motion,
  radius,
  spacing,
  type,
} from '../theme/tokens';

const EASE = Easing.bezier(easing.x1, easing.y1, easing.x2, easing.y2);

type Destination =
  | { kind: 'coach' }
  | { kind: 'module'; moduleId: string; entryId: string };

export function DrawerHost({ enabled }: { enabled: Record<string, boolean> }) {
  const theme = useTheme();
  const router = useRouter();
  const { refresh } = useSession();
  const { width } = useWindowDimensions();

  const coach = useMemo(() => coachProvider(), []);
  const sections = useMemo(
    () => drawerSections(enabled, config.appName),
    [enabled]
  );
  const firstEntry = sections[0]?.entries[0];

  const [destination, setDestination] = useState<Destination>(() =>
    coach ? { kind: 'coach' } : firstEntry
      ? { kind: 'module', moduleId: firstEntry.moduleId, entryId: firstEntry.id }
      : { kind: 'coach' }
  );
  // Development affordance: open the drawer on launch so its layout can be
  // inspected without driving the simulator. Set in .env.development only.
  const [open, setOpen] = useState(
    __DEV__ && process.env.EXPO_PUBLIC_DEV_OPEN_DRAWER === '1'
  );
  const [bugNotice, setBugNotice] = useState(false);
  const [failedCount, setFailedCount] = useState(() => outboxCounts().failed);

  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: motion.drawer, easing: EASE });
  }, [open, progress]);

  useEffect(() => onOutboxChange(() => setFailedCount(outboxCounts().failed)), []);

  // A module screen's header asks for the drawer as it navigates back here,
  // because it cannot reach this state from above in the stack. Acting on
  // focus rather than on the call itself is what makes one press enough: the
  // request arrives while this route is still being restored, so anything
  // done immediately is undone by the render that follows.
  useFocusEffect(
    useCallback(() => {
      if (consumeOpenDrawerRequest()) setOpen(true);
    }, [])
  );

  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * drawerTokens.slide },
      { scale: interpolate(progress.value, [0, 1], [1, drawerTokens.scale]) },
    ],
    borderRadius: progress.value * drawerTokens.radius,
  }));

  const go = useCallback((d: Destination) => {
    setDestination(d);
    setOpen(false);
  }, []);

  const activeScreen = useMemo(() => {
    if (destination.kind === 'coach') return null;
    for (const section of sections) {
      const entry = section.entries.find(
        (e) => e.moduleId === destination.moduleId && e.id === destination.entryId
      );
      if (entry) return entry;
    }
    return null;
  }, [destination, sections]);

  const title =
    destination.kind === 'coach' ? config.appName : (activeScreen?.label ?? config.appName);

  if (!coach && sections.length === 0) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }]}>
        <EmptyState
          icon="lock-outline"
          title="Nothing is enabled for your account yet"
          body="Ask your trainer or administrator to enable access, then check again."
          action={<Button title="Check again" variant="secondary" onPress={() => void refresh()} />}
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.void }]}>

      {/* The menu underneath: a flat list of destinations with Settings
          last, then Recents, then the New chat pill — per the design. */}
      <SafeAreaView style={styles.drawer} edges={['top', 'bottom']}>
        <View style={styles.drawerHead}>
          <Text style={[type.title, { color: theme.invert }]}>{config.appName}</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.navList}>
          {coach ? (
            <DrawerRow
              icon="message-outline"
              label="Coach"
              active={destination.kind === 'coach'}
              onPress={() => go({ kind: 'coach' })}
            />
          ) : null}

          {sections.map((section) => (
            <React.Fragment key={section.title}>
              {/* A heading only earns its place once there is more than one
                  group; a single family reads as a flat list, as designed. */}
              {sections.length > 1 ? <Caps style={styles.sectionLabel}>{section.title}</Caps> : null}
              {section.entries.map((entry) => (
                <DrawerRow
                  key={entry.moduleId + ':' + entry.id}
                  icon={entry.icon}
                  label={entry.label}
                  active={
                    destination.kind === 'module' &&
                    destination.moduleId === entry.moduleId &&
                    destination.entryId === entry.id
                  }
                  onPress={() => go({ kind: 'module', moduleId: entry.moduleId, entryId: entry.id })}
                />
              ))}
            </React.Fragment>
          ))}

          <DrawerRow
            icon="cog-outline"
            label="Settings"
            badge={failedCount > 0}
            onPress={() => {
              setOpen(false);
              router.push('/settings');
            }}
          />

        </ScrollView>

      </SafeAreaView>

      {/* The active surface, which slides right to reveal the menu */}
      <Animated.View style={[styles.surface, { backgroundColor: theme.background }, surfaceStyle]}>
        {/* The living gradient sits behind the app surface only, so the
            drawer underneath stays a flat dark ground. */}
        <AmbientBackground />
        {/* The header IS the fade, per the design: it floats over the
            scrolling content (z-index 3) so messages pass beneath it and
            dissolve rather than ending on a hard edge.
            `padding: 64px 22px 18px` with a 180deg gradient at .97/.85/0,
            where the design's 64px status bar becomes the safe-area inset. */}
        <LinearGradient
          colors={[
            withAlpha(theme.headerScrim, layout.headerFadeStops[0]),
            withAlpha(theme.headerScrim, layout.headerFadeStops[1]),
            withAlpha(theme.headerScrim, layout.headerFadeStops[2]),
          ]}
          locations={headerFadeLocations(insets.top)}
          style={[
            styles.header,
            { paddingTop: insets.top + layout.headerTopGap, paddingBottom: layout.headerFadeDrop },
          ]}
        >
          <Pressable
            onPress={() => setOpen((o) => !o)}
            hitSlop={12}
            style={[styles.headerCircle, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Icon name={open ? 'close' : 'menu'} size={18} color={theme.text} />
            {failedCount > 0 && !open ? (
              <View style={[styles.dot, { backgroundColor: theme.danger }]} />
            ) : null}
          </Pressable>
          {/* A destination shows its name; the coach home does not, so the
              greeting is the first thing read. */}
          {destination.kind === 'module' ? (
            <Text style={[type.cardTitle, { color: theme.text }]}>{title}</Text>
          ) : null}
          {/* Bug reporter. The screenshot-and-send flow is not built yet;
              the control is here because the design places it here. */}
          <Pressable
            hitSlop={12}
            onPress={() => setBugNotice(true)}
            style={[styles.headerCircle, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Icon name="bug" size={17} color={theme.textSecondary} />
          </Pressable>
        </LinearGradient>

        <View
          style={[
            styles.fill,
            // The coach thread scrolls under the floating header and fades
            // out. Module screens are not built for that, so they start
            // below it.
            destination.kind === 'coach'
              ? null
              : { paddingTop: headerHeight(insets.top) },
          ]}
        >
          {destination.kind === 'coach' ? (
            <CoachHome enabled={enabled} />
          ) : activeScreen ? (
            <LazyThunk key={destination.moduleId + ':' + destination.entryId} thunk={activeScreen.screen} />
          ) : null}
        </View>

        {open ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        ) : null}
      </Animated.View>
    </View>
  );
}

function DrawerRow({
  icon,
  label,
  onPress,
  active = false,
  badge = false,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  active?: boolean;
  badge?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { opacity: 0.6 } : null]}
    >
      <Icon name={icon} size={19} color={active ? theme.invert : theme.textSecondary} />
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          fontSize: 17,
          fontWeight: '600',
          color: active ? theme.invert : theme.textSecondary,
        }}
      >
        {label}
      </Text>
      {badge ? <View style={[styles.dot, { backgroundColor: theme.danger, position: 'relative', top: 0, right: 0 }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: drawerTokens.slide,
    paddingHorizontal: 26,
    paddingTop: 34,
    paddingBottom: 20,
  },
  drawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navList: { gap: 2, marginTop: 26, paddingBottom: spacing.lg },
  sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.sm },
  recent: { paddingVertical: 9 },
  drawerFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    paddingVertical: 12,
    paddingHorizontal: 22,
    minHeight: 44,
  },
  group: { gap: spacing.xs },
  surface: { flex: 1, overflow: 'hidden' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.headerPaddingH,
  },
  headerCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11 },
  dot: { position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: 5 },
});
