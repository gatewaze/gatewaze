/**
 * The coach home: greeting, thread, and the docked composer
 * (spec-mobile-coach-rebrand.md).
 *
 * The core owns this surface but knows nothing about any module's data.
 * One module drives the conversation through `coachProvider`, and rich
 * cards are rendered by whichever module registered the card's kind, so
 * food cards and workout drafts appear in the same thread without the
 * core calling either module's API.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../components/Icon';
import { GlassPanel } from '../components/GlassPanel';
import { ChatBubble, SuggestionChip } from '../components/ChatBubble';
import { LazyThunk } from '../components/LazyThunk';
import { Caps, Caption, Greeting, LoadingState, withAlpha } from '../components/primitives';
import { coachProvider, composerModes, threadCardRenderer } from './registry';
import { getModuleContext } from './context';
import { ChromeInsetsProvider } from './chrome';
import { consumeCoachHandoff } from './coachHandoff';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedKeyboard,
  useAnimatedReaction,
  runOnJS,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  useTheme,
  radius,
  spacing,
  type,
  motion,
  easing as easingToken,
  layout,
  headerHeight,
} from '../theme/tokens';
import type { MobileCoachMessage, MobileCoachGreeting } from '@gatewaze/shared';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// The composer's fade is moved by an animated transform, so the gradient
// itself has to be an animated component.
const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export function CoachHome({ enabled }: { enabled: Record<string, boolean> }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const coach = useMemo(() => coachProvider(), []);
  const modes = useMemo(() => composerModes(enabled), [enabled]);

  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<MobileCoachMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  // Props a mode was handed off with, cleared whenever the member picks a
  // mode themselves so a pill press always opens that mode's plain surface.
  const [modeProps, setModeProps] = useState<Record<string, unknown>>({});
  const [greeting, setGreeting] = useState<MobileCoachGreeting | undefined>();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  /** Messages sent while the coach was mid-reply, waiting their turn. */
  const [queued, setQueued] = useState<string[]>([]);

  // Auto-scrolling unconditionally fought the member: any content change
  // while they were reading further up yanked them back down. Follow the
  // thread only when they are already at the end of it.
  const atBottom = useRef(true);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    atBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80;
  }, []);

  // Opening a capture mode hands the screen to the camera or scanner, so
  // the keyboard has nothing left to type into and would cover the controls.
  const selectMode = useCallback((key: string | null) => {
    setActiveMode(key);
    setModeProps({});
    if (key !== null) Keyboard.dismiss();
  }, []);

  /**
   * Pick up a message or a mode left by the composer bar on another
   * destination.
   *
   * Runs on every render pass where `coach` is ready rather than on mount:
   * moving here does not remount this surface, and a handover left while the
   * provider was still loading would otherwise be dropped. `consume` clears
   * the handover, so this cannot send the same message twice.
   */
  useEffect(() => {
    if (!coach) return;
    const handoff = consumeCoachHandoff();
    if (!handoff) return;
    if (handoff.mode) selectMode(handoff.mode);
    if (handoff.text) void send(handoff.text);
  });

  const followIfAtEnd = useCallback(
    (animated: boolean) => {
      if (atBottom.current) scrollRef.current?.scrollToEnd({ animated });
    },
    []
  );

  // KeyboardAvoidingView positions itself by measuring its own frame on
  // screen, and this surface sits inside the drawer's animated translate and
  // scale, which makes that measurement wrong: the composer stayed put and
  // the keyboard covered it. Reading the keyboard height from the platform
  // instead is immune to any ancestor transform.
  const keyboard = useAnimatedKeyboard();

  // The composer is moved by a transform, not by padding on its parent.
  // Reanimated applies a padding change on the UI thread without a fresh
  // Yoga pass, and an absolutely positioned child keeps the position layout
  // already gave it, so the composer stayed under the keyboard on device.
  // A transform is applied directly to the view and cannot miss.
  const composerShift = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));

  // Room for the keyboard at the end of the thread, so the newest message can
  // still be scrolled clear of it. A spacer rather than animated padding:
  // contentContainerStyle is not an animatable prop on Animated.ScrollView.
  const keyboardSpacer = useAnimatedStyle(() => ({ height: keyboard.height.value }));

  // Shrinking the content area does not change the thread's content size, so
  // the ScrollView will not scroll itself. Follow the keyboard so the newest
  // message stays in view as it opens.
  useAnimatedReaction(
    () => keyboard.height.value,
    (height, previous) => {
      if (previous !== null && height !== previous) runOnJS(followIfAtEnd)(false);
    }
  );

  // The app has exactly one coach conversation. Open the member's existing
  // thread, or start it the first time.
  useEffect(() => {
    if (!coach) return;
    let alive = true;
    (async () => {
      const ctx = getModuleContext();
      try {
        const threads = await coach.threads(ctx);
        const existing = threads[0]?.id;
        if (!alive) return;
        if (existing) {
          setThreadId(existing);
          const m = await coach.thread(ctx, existing);
          if (alive) setMessages(m);
        }
      } catch {
        if (alive) setError('That conversation could not be loaded.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [coach]);

  useEffect(() => {
    if (!coach?.greeting || messages.length > 0) return;
    let alive = true;
    coach
      .greeting(getModuleContext())
      .then((g) => alive && setGreeting(g))
      .catch(() => {
        /* The greeting is decoration; a failure just leaves the default. */
      });
    return () => {
      alive = false;
    };
  }, [coach, messages.length]);

  const send = useCallback(
    async (text: string, alreadyShown = false) => {
      if (!coach || !text.trim()) return;
      // A second message while the coach is still answering is QUEUED, not
      // dropped. Returning early here used to lose it silently: the member
      // watched their words vanish from the box with nothing added to the
      // thread. It is sent as soon as the current exchange finishes.
      if (busy) {
        setDraft('');
        setQueued((prev) => [...prev, text.trim()]);
        setMessages((prev) => [
          ...prev,
          {
            id: 'queued-' + Date.now(),
            role: 'member',
            text: text.trim(),
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }
      const ctx = getModuleContext();
      setBusy(true);
      setError(null);
      setDraft('');
      setModeProps({});
      // Sending is a chat action, so leave any capture mode and show the
      // thread: otherwise the camera stays up and the member cannot see
      // what they sent or the reply to it.
      setActiveMode(null);

      // A queued message is already in the thread from when it was typed, so
      // painting another bubble would show it twice until generate() returns.
      if (!alreadyShown) {
        setMessages((prev) => [
          ...prev,
          {
            id: 'local-' + Date.now(),
            role: 'member',
            text: text.trim(),
            createdAt: new Date().toISOString(),
          },
        ]);
      }

      try {
        let id = threadId;
        if (!id) {
          id = await coach.createThread(ctx);
          setThreadId(id);
        }
        await coach.send(ctx, id, text.trim());
        setMessages((prev) => [
          ...prev,
          {
            id: 'pending-' + Date.now(),
            role: 'coach',
            createdAt: new Date().toISOString(),
            pending: true,
          },
        ]);
        const updated = await coach.generate(ctx, id);
        setMessages(updated);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => !m.pending));
        setError(
          err instanceof Error ? err.message : 'That message could not be sent. Try again.'
        );
      } finally {
        setBusy(false);
      }
    },
    [coach, threadId, busy]
  );

  // Drain one queued message per idle turn. The optimistic bubble for it is
  // already in the thread, and generate() returns the authoritative list, so
  // it is not painted twice.
  useEffect(() => {
    if (busy || queued.length === 0) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void send(next, true);
  }, [busy, queued, send]);

  if (!coach) {
    return (
      <View style={[styles.fill, styles.centered]}>
        <Caption>No coach is configured for this app.</Caption>
      </View>
    );
  }
  if (loading) return <LoadingState />;

  // Mode ids are only unique within a module, so the active mode is
  // tracked by the same '<moduleId>:<id>' key the registry uses.
  const modeKey = (m: { moduleId: string; id: string }) => `${m.moduleId}:${m.id}`;
  const mode = modes.find((m) => modeKey(m) === activeMode);

  return (
    <Animated.View style={styles.fill}>
      {/* The content area. A mode surface (camera, scanner, search) fills
          it, so the composer below stays docked and visible — the design
          puts the camera layer above the composer, never under it. */}
      {mode ? (
        <ChromeInsetsProvider top={headerHeight(insets.top)} bottom={composerHeight}>
          <LazyThunk
            key={modeKey(mode)}
            thunk={mode.surface}
            props={{
              onDismiss: () => selectMode(null),
              threadId,
              // Handing off keeps the mode pill in step with what is on
              // screen. The id is bare, so a module never has to know the
              // '<moduleId>:<id>' key the core uses.
              switchMode: (id: string, props?: Record<string, unknown>) => {
                setActiveMode(`${mode.moduleId}:${id}`);
                setModeProps(props ?? {});
              },
              ...modeProps,
            }}
          />
        </ChromeInsetsProvider>
      ) : (
        <Animated.ScrollView
          ref={scrollRef}
          style={styles.fill}
          contentContainerStyle={[
            styles.thread,
            {
              paddingTop: headerHeight(insets.top),
              // Clear the floating composer so the last message can be read.
              paddingBottom: composerHeight + spacing.lg,
            },
          ]}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={() => followIfAtEnd(true)}
          // "on-drag", not "interactive". Interactive dismissal drags the
          // keyboard with the finger without reporting height as it moves, so
          // the composer stayed where it was and only jumped to the bottom on
          // release. A drag dismissal is a normal animated one, which the
          // keyboard height does follow, so the composer travels with it.
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={styles.intro}>
              <Greeting>{greeting?.title ?? 'How can I help?'}</Greeting>
              {greeting?.subtitle ? (
                <Text style={[type.body, styles.subtitle, { color: theme.textSecondary }]}>
                  {greeting.subtitle}
                </Text>
              ) : (
                // Deliberately generic: this is the fallback for when the
                // coach module supplies no greeting, and the core has no idea
                // what the app it is running is for. Anything specific here
                // would be wrong in a build with different modules.
                <Caption>Ask me anything to get started.</Caption>
              )}
              {greeting?.starters?.length ? (
                <View style={styles.starters}>
                  <Caps>For you</Caps>
                  {greeting.starters.map((starter) => (
                    <Pressable
                      key={starter}
                      onPress={() => void send(starter)}
                      style={({ pressed }) => [
                        styles.starter,
                        {
                          backgroundColor: theme.surface,
                          borderColor: theme.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.starterDot, { backgroundColor: theme.accent }]} />
                      <Text style={[type.body, { color: theme.text, flex: 1 }]}>{starter}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {messages.map((message, i) => {
            const isLatestCoach =
              message.role === 'coach' && i === messages.length - 1 && !message.pending;
            return (
              <View key={message.id} style={{ gap: spacing.sm }}>
                {message.text || message.pending ? (
                  <ChatBubble
                    role={message.role}
                    latestCoach={isLatestCoach}
                    pending={message.pending}
                  >
                    {message.text ?? ''}
                  </ChatBubble>
                ) : null}

                {(message.cards ?? []).map((card, ci) => (
                  <ThreadCard key={ci} kind={card.kind} payload={card.payload} threadId={threadId} />
                ))}

                {isLatestCoach && message.choices?.length ? (
                  <View style={styles.chips}>
                    {message.choices.map((choice) => (
                      <SuggestionChip key={choice} label={choice} onPress={() => void send(choice)} />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}

          {error ? <Caption style={{ color: theme.danger }}>{error}</Caption> : null}
          <Animated.View style={keyboardSpacer} />
        </Animated.ScrollView>
      )}

      {/* The composer floats over the thread rather than sitting below it:
          as a sibling it cut the canvas off on a hard edge. Its fade is the
          mirror of the header's, so messages dissolve at both ends. */}
      <AnimatedLinearGradient
        colors={[
          withAlpha(theme.background, layout.composerFadeStops[0]),
          withAlpha(theme.background, layout.composerFadeStops[1]),
          withAlpha(theme.background, layout.composerFadeStops[2]),
        ]}
        locations={[
          layout.composerFadeLocations[0],
          layout.composerFadeLocations[1],
          layout.composerFadeLocations[2],
        ]}
        style={[styles.composerWrap, composerShift]}
        onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
      >
        {/* One radius on all four corners. Matching the bottom pair to the
            display's own curve left them much rounder than the top pair,
            which read as lopsided; an even shape looks better than a
            concentric one here. */}
        <GlassPanel radius={radius.composer} style={styles.composer}>
          <View style={styles.inputRow}>
            <TextInput
              // Development affordance: focus on mount so keyboard-avoidance
              // can be inspected without driving the simulator by hand.
              autoFocus={__DEV__ && process.env.EXPO_PUBLIC_DEV_FOCUS_COMPOSER === '1'}
              value={draft}
              onChangeText={setDraft}
              placeholder={mode?.id === 'search' ? 'Search the food database' : 'Ask me anything...'}
              placeholderTextColor={theme.textMuted}
              multiline
              style={[type.chat, styles.input, { color: theme.text }]}
            />
          </View>

          <View style={styles.toolbar}>
            {modes.length > 0 ? (
              <View style={[styles.track, { backgroundColor: theme.controlFill, borderColor: 'rgba(255,255,255,0.12)' }]}>
                <ModePill
                  icon="message-outline"
                  label="Chat"
                  active={activeMode === null}
                  onPress={() => selectMode(null)}
                />
                {modes.map((m) => (
                  <ModePill
                    key={modeKey(m)}
                    icon={m.icon}
                    label={m.label}
                    active={activeMode === modeKey(m)}
                    onPress={() => selectMode(activeMode === modeKey(m) ? null : modeKey(m))}
                  />
                ))}
              </View>
            ) : null}

            <CircleButton icon="microphone" onPress={() => {}} disabled prominent />
            <Pressable
              onPress={() => void send(draft)}
              disabled={!draft.trim() || busy}
              style={[
                styles.sendButton,
                { backgroundColor: theme.accent, opacity: draft.trim() && !busy ? 1 : 0.4 },
              ]}
            >
              <Icon name="arrow-up" size={18} color={theme.onAccent} />
            </Pressable>
          </View>
        </GlassPanel>
      </AnimatedLinearGradient>
    </Animated.View>
  );
}

/** Dispatches a rich card to the module that registered its kind. */
function ThreadCard({
  kind,
  payload,
  threadId,
}: {
  kind: string;
  payload: unknown;
  threadId?: string;
}) {
  const theme = useTheme();
  const renderer = useMemo(() => threadCardRenderer(kind), [kind]);
  if (!renderer) {
    return (
      <GlassPanel style={{ padding: spacing.lg }}>
        <Caption>This card needs an app update to display.</Caption>
      </GlassPanel>
    );
  }
  return <LazyThunk thunk={renderer} props={{ payload, threadId }} />;
}

function CircleButton({
  icon,
  onPress,
  active = false,
  disabled = false,
  prominent = false,
}: {
  icon: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
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
      <Icon name={icon} size={16} color={filled ? theme.onInvert : theme.text} />
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
      style={[
        styles.pill,
        active ? styles.pillActive : null,
        { backgroundColor: active ? theme.invert : 'transparent' },
        pillStyle,
      ]}
    >
      <Icon name={icon} size={15} color={active ? theme.onInvert : theme.textMuted} />
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
  fill: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  thread: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  intro: { paddingTop: spacing.xl, gap: spacing.sm },
  subtitle: { fontStyle: 'italic' },
  starters: { marginTop: spacing.xl, gap: spacing.sm, alignItems: 'flex-start' },
  starter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  starterDot: { width: 7, height: 7, borderRadius: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  composerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    paddingTop: layout.composerPadTop,
    paddingHorizontal: layout.composerMargin,
    paddingBottom: layout.composerPadBottom,
  },
  composer: {},
  // Roomier than the original: the prompt needs air above and below.
  inputRow: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  input: { minHeight: 40, maxHeight: 120, paddingVertical: 8 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  spacer: { flex: 1 },
  track: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    padding: 3,
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    height: 30,
    justifyContent: 'center',
  },
  pillActive: { flex: 1 },
  pillLabel: { overflow: 'hidden' },
});
