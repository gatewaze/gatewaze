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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPanel } from '../components/GlassPanel';
import { ChatBubble, SuggestionChip } from '../components/ChatBubble';
import { LazyThunk } from '../components/LazyThunk';
import { Caps, Caption, Greeting, LoadingState } from '../components/primitives';
import { Composer, CAMERA_MODE } from './Composer';
import { CameraMode } from './CameraMode';
import { coachProvider, composerModes, threadCardRenderer } from './registry';
import { getModuleContext } from './context';
import { ChromeInsetsProvider } from './chrome';
import { consumeCoachHandoff } from './coachHandoff';
import { setCoachPrompts } from './coachPrompts';
import Animated, {
  useAnimatedStyle,
  useAnimatedKeyboard,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';
import { useTheme, radius, spacing, type, headerHeight } from '../theme/tokens';
import type { MobileCoachMessage, MobileCoachGreeting } from '@gatewaze/shared';

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
  /**
   * A notice the member tapped, waiting to be shown at the end of the thread.
   *
   * Held rather than sent: a notice is not a message from the member, and
   * writing one into the conversation would put words in their mouth.
   */
  const [pendingNotice, setPendingNotice] = useState<
    { noticeId: string; sendId: string; payload?: unknown } | null
  >(null);

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
    if (handoff.kind === 'notice') {
      // A tapped notification. The prompt itself is the contributing module's
      // thread card, so this only has to put it in the thread; the card knows
      // how to be acknowledged and talks to its own module's API.
      setPendingNotice(handoff.notice);
      return;
    }
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
      .then((g) => {
        if (!alive) return;
        setGreeting(g);
        // Publish the openers for every composer, including the ones on
        // destinations that never load a greeting of their own.
        if (g?.starters?.length) setCoachPrompts(g.starters);
      })
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
  // The camera is the core's own mode rather than any module's, because the
  // modules it serves are several and a mode belongs to one module. See the
  // note on CAMERA_MODE.
  const cameraOpen = activeMode === CAMERA_MODE;

  return (
    <Animated.View style={styles.fill}>
      {/* The content area. A mode surface (camera, scanner, search) fills
          it, so the composer below stays docked and visible — the design
          puts the camera layer above the composer, never under it. */}
      {cameraOpen ? (
        <ChromeInsetsProvider top={headerHeight(insets.top)} bottom={composerHeight}>
          <CameraMode onDismiss={() => selectMode(null)} />
        </ChromeInsetsProvider>
      ) : mode ? (
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

          {/* A tapped notification, shown at the end of the thread as the
              contributing module's own card. Dismissing it leaves the thread
              as it was: a notice is something the app said, not something the
              member did, so it does not become a message. */}
          {pendingNotice ? (
            <View style={styles.group}>
              <ThreadCard
                kind={pendingNotice.noticeId}
                payload={pendingNotice.payload}
                threadId={threadId}
              />
              <SuggestionChip label="Dismiss" onPress={() => setPendingNotice(null)} />
            </View>
          ) : null}

          {error ? <Caption style={{ color: theme.danger }}>{error}</Caption> : null}
          <Animated.View style={keyboardSpacer} />
        </Animated.ScrollView>
      )}

      {/* The composer floats over the thread rather than sitting below it:
          as a sibling it cut the canvas off on a hard edge. Its fade is the
          mirror of the header's, so messages dissolve at both ends. */}
      <Composer
        enabled={enabled}
        draft={draft}
        onChangeDraft={setDraft}
        activeMode={activeMode}
        onSelectMode={selectMode}
        onSend={() => void send(draft)}
        placeholder={mode?.id === 'search' ? 'Search the food database' : undefined}
        busy={busy}
        /**
         * The coach opens with a caret in the field.
         *
         * Nothing else on this screen says "you can type here": the composer
         * is a dark panel with a placeholder, and a member has to guess that
         * tapping it does something. A caret says it without a word.
         *
         * Only on the coach. Every other destination shows a list the member
         * came to read, and opening the keyboard over it would be answering
         * a question nobody asked.
         *
         * The cost is that the keyboard covers part of the thread on arrival.
         * That is survivable here because the composer rides the keyboard and
         * the thread follows it, so the newest message stays in view.
         */
        autoFocus
        onHeight={setComposerHeight}
        zIndex={5}
      />
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
  // A tapped notice and its dismiss, kept together at the end of the thread.
  group: { gap: spacing.sm, alignItems: 'flex-start' },
  spacer: { flex: 1 },
});
