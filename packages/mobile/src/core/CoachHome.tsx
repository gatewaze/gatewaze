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
import { Body, Caps, Caption, Greeting, LoadingState } from '../components/primitives';
import { Icon } from '../components/Icon';
import { Composer, CAMERA_MODE } from './Composer';
import { CameraMode } from './CameraMode';
import { chatProvider, composerModes, moduleColor, moduleOfKind, threadCardRenderer } from './registry';
import { getModuleContext } from './context';
import { ChromeInsetsProvider } from './chrome';
import { replyArrived, stopHeartbeat } from './haptics';
import { consumeCoachHandoff } from './coachHandoff';
import { humanMessage } from './errors';
import { setCoachPrompts } from './coachPrompts';
import Animated, {
  FadeIn,
  FadeOut,
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
  const coach = useMemo(() => chatProvider(), []);
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
  /** The last send that failed, kept so it can be retried unchanged. */
  const [failed, setFailed] = useState<{ text: string; alreadyShown: boolean } | null>(null);
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
    { noticeId: string; sendId: string; cardKind?: string; payload?: unknown } | null
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
    // Not before the thread list has loaded: this effect and the loader run
    // on the same mount, and a send with `threadId` still null creates a
    // second thread on the server. The member's message then lands in a
    // conversation the app never shows — a reply that "never arrived", and,
    // because the thread list is newest-first, the next launch would open
    // the stray thread and hide their whole history. The handoff keeps until
    // consumed, so waiting a render loses nothing.
    if (!coach || loading) return;
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

  /**
   * The app has exactly one conversation. Open it, creating it if this is the
   * first launch.
   *
   * ── WHY THIS CREATES RATHER THAN WAITS ────────────────────────────────────
   *
   * It used to only open a thread that already existed, and a thread only
   * existed once the member had sent something. That made onboarding
   * unreachable: the questions are assembled while generating a REPLY, so a
   * new member who opened the app and read the empty screen was never asked
   * anything, and nothing on screen suggested they had to go first.
   *
   * Creating the thread here is what lets the assistant open the conversation.
   * The route is idempotent — it returns the existing conversation when there
   * is one — so this is also the ordinary resume path, and it generates an
   * opening message at most once per member.
   */
  useEffect(() => {
    if (!coach) return;
    let alive = true;
    (async () => {
      const ctx = getModuleContext();
      try {
        const threads = await coach.threads(ctx);
        if (!alive) return;
        // createThread resolves to the existing id when there is one, so the
        // list is only consulted to avoid a needless round trip.
        const id = threads[0]?.id ?? (await coach.createThread(ctx));
        if (!alive || !id) return;
        setThreadId(id);
        const m = await coach.thread(ctx, id);
        if (alive) setMessages(m);
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

  /**
   * The honest label for a mode, or null.
   *
   * Null is the common case and is meant to be: an ordinary typed message goes
   * to the assistant and comes back, and the app has nothing to add about the
   * middle of that.
   */
  const statusForMode = useCallback((key: string | null): string | null => {
    if (!key) return null;
    const id = key.slice(key.indexOf(':') + 1);
    if (id === 'camera' || id === 'photo') return 'Reading your photo';
    if (id === 'barcode') return 'Looking up the barcode';
    if (id === 'search') return 'Searching the food database';
    return null;
  }, []);

  const send = useCallback(
    async (text: string, alreadyShown = false) => {
      if (!coach || !text.trim()) return;
      // A second message while the coach is still answering — or any message
      // while the thread list is still loading — is QUEUED, not
      // dropped. Returning early here used to lose it silently: the member
      // watched their words vanish from the box with nothing added to the
      // thread. It is sent as soon as the current exchange finishes.
      if (busy || loading) {
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
      setFailed(null);
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
            /**
             * What the app is actually doing, taken from the mode the member
             * sent from — the one thing the client can state truthfully.
             *
             * There is no progress channel from the server: a turn is one
             * request that returns a finished reply, so anything more specific
             * than this would be invented. A status line that guesses is worse
             * than dots, because a member who reads "searching the food
             * database" during a question about their knee stops trusting the
             * next one.
             */
            status: statusForMode(activeMode),
          },
        ]);
        const updated = await coach.generate(ctx, id);
        setMessages(updated);
        // The reply landed: beat in time with the glow on the new bubble.
        replyArrived();
      } catch (err) {
        setMessages((prev) => prev.filter((m) => !m.pending));
        /**
         * The raw message is never the right thing to show.
         *
         * This used to read `err instanceof Error ? err.message : 'friendly'`,
         * which looks careful and does the opposite: a real Error always wins,
         * so the friendly text only ran for something that was not an Error at
         * all. On one bar of LTE that put "Network request failed" under the
         * member's own message, in red, which tells them nothing to do about it
         * and reads like the app broke.
         */
        const human = humanMessage(err);
        setError(human.text);
        // Held so the member can try the same message again rather than
        // retyping it. Their bubble stays in the thread, so without this it
        // looks sent and silently is not.
        setFailed({ text, alreadyShown: true });
      } finally {
        setBusy(false);
      }
    },
    [coach, threadId, busy, loading]
  );

  // Drain one queued message per idle turn. The optimistic bubble for it is
  // already in the thread, and generate() returns the authoritative list, so
  // it is not painted twice.
  useEffect(() => {
    if (busy || loading || queued.length === 0) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void send(next, true);
  }, [busy, loading, queued, send]);

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
      {/*
        Each surface fades, so switching between chat, photo and barcode
        crosses over instead of cutting.

        The outgoing one is still fading while the incoming one appears —
        Reanimated holds an exiting view until its animation finishes — which
        is what makes it a cross-fade rather than a blink through the
        background. Keyed per surface so a switch is a genuine unmount and
        mount, which is what the animations key off.

        Short on purpose. This sits between a tap and the thing the member
        asked for, so anything slower would be felt as lag rather than read
        as polish.
      */}
      {cameraOpen ? (
        <Animated.View
          key="surface:camera"
          style={styles.fill}
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
        >
        <ChromeInsetsProvider top={headerHeight(insets.top)} bottom={composerHeight}>
          <CameraMode onDismiss={() => selectMode(null)} />
        </ChromeInsetsProvider>
        </Animated.View>
      ) : mode ? (
        <Animated.View
          key={`surface:${modeKey(mode)}`}
          style={styles.fill}
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
        >
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
        </Animated.View>
      ) : (
        <Animated.ScrollView
          key="surface:chat"
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
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
          /**
           * Jump, never glide. The animated scrollToEnd this used sabotaged
           * itself: the animation's own intermediate scroll events report
           * positions far from the bottom, onScroll read them as the member
           * scrolling up and cleared atBottom, and when a card finished loading
           * a moment later the follow logic thought they had scrolled away —
           * parked partway down on every switch to the coach. An unanimated
           * jump emits no intermediate positions, so bottom-following survives
           * and every open lands on the newest message. Highlighting a specific
           * message from another screen, when it exists, will be an explicit
           * target rather than a change to this default.
           */
          onContentSizeChange={() => followIfAtEnd(false)}
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
              {/* The opening's one action, drawn by whichever module supplied
                  it. A starter can only say something; this can do something,
                  which is what "start today's session" needs. */}
              {greeting?.card ? (
                <View style={styles.group}>
                  <ThreadCard
                    kind={greeting.card.kind}
                    payload={greeting.card.payload}
                    threadId={threadId}
                  />
                </View>
              ) : null}
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
                    status={message.status}
                  >
                    {message.text ?? ''}
                  </ChatBubble>
                ) : null}

                {(message.cards ?? []).map((card, ci) => (
                  <ThreadCard
                    key={ci}
                    kind={card.kind}
                    payload={card.payload}
                    threadId={threadId}
                    onSend={(text) => void send(text)}
                  />
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
                /* The card the notice named, falling back to its own id. A
                   medication reminder names health-meds' existing take/skip
                   card rather than a surface built for notifications. */
                kind={pendingNotice.cardKind ?? pendingNotice.noticeId}
                /* `sendId` rides along in the payload because a card has to be
                   able to say what the member did with it, and 'acted' is the
                   only outcome that resets the cooling-off ladder. Without a
                   way to report it, every prompt a member acted on would still
                   count as ignored six hours later, and the app would
                   eventually switch off the notices that were working. */
                payload={{
                  ...(typeof pendingNotice.payload === 'object' && pendingNotice.payload !== null
                    ? (pendingNotice.payload as Record<string, unknown>)
                    : {}),
                  sendId: pendingNotice.sendId,
                  noticeId: pendingNotice.noticeId,
                }}
                threadId={threadId}
              />
              <SuggestionChip label="Dismiss" onPress={() => setPendingNotice(null)} />
            </View>
          ) : null}

          {error ? (
            /**
             * On a surface, not loose on the background.
             *
             * It was bare coloured text over the mesh, which drifts through
             * every hue the app uses — so the one message that has to be read
             * calmly was the least readable thing on screen, and its contrast
             * changed as the background moved. A panel gives it a constant
             * ground to sit on, and the accent stripe carries the "this went
             * wrong" signal so the text itself can be ordinary ink.
             */
            <View style={styles.group}>
              <View style={[styles.errorPanel, { borderColor: theme.danger, backgroundColor: theme.surface }]}>
                <View style={[styles.errorStripe, { backgroundColor: theme.danger }]} />
                <View style={styles.errorBody}>
                  <Icon name="alert-circle-outline" size={18} color={theme.danger} />
                  <Body style={{ flex: 1, color: theme.text }}>{error}</Body>
                </View>
              </View>
              {/* The member's bubble is still in the thread, so without a way
                  to send it again it looks sent and silently is not. */}
              {failed ? (
                <SuggestionChip
                  label="Try again"
                  onPress={() => {
                    const held = failed;
                    setFailed(null);
                    void send(held.text, held.alreadyShown);
                  }}
                />
              ) : null}
            </View>
          ) : null}
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
        /* The composer hint is for a first conversation only. Anyone who has
           already sent something has demonstrably worked out how to. */
        hintEligible={!messages.some((m) => m.role === 'member')}
        /*
         * The coach does NOT open with a caret in the field, and this is
         * deliberate rather than an omission.
         *
         * It used to. The reason was discoverability: the composer was a dark
         * panel with a static placeholder, and a member had to guess that
         * tapping it did anything, so a caret said it without a word.
         *
         * The cycling placeholder now says it instead, and says it better. It
         * types out real questions the coach can answer, so it shows what to
         * ask as well as where to ask it. With a caret in front of it the
         * animation reads as the app typing into its own field, which is the
         * opposite of an invitation.
         *
         * The keyboard also cost half the screen on arrival, covering the
         * thread the member came back to read.
         */
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
  onSend,
}: {
  kind: string;
  payload: unknown;
  threadId?: string;
  /**
   * Lets a card continue the conversation it is sitting in.
   *
   * Added for the onboarding connect card: once the member has connected
   * Apple Health, something has to tell the assistant to carry on with what
   * it still does not know. The alternative was for the card to leave a
   * handoff and hope the thread picked it up, which is the cross-SCREEN
   * mechanism — pointless here, where the card is already inside the thread
   * that owns send().
   *
   * Optional, so every existing card is unaffected.
   */
  onSend?: (text: string) => void;
}) {
  const theme = useTheme();
  const renderer = useMemo(() => threadCardRenderer(kind), [kind]);
  /**
   * The hairline that says which part of the app is speaking.
   *
   * The thread carries cards from several modules — a meal, a workout, a
   * medication reminder — and with nothing to tell them apart it reads as one
   * undifferentiated column. The module is recovered from the card's own
   * namespaced kind, so a card does not have to declare it.
   *
   * A hairline rather than a fill, on purpose: filling each card in its
   * module's colour turns a conversation into a chart, and the words are the
   * thing being read.
   */
  const accent = useMemo(() => {
    const owner = moduleOfKind(kind);
    return (owner ? moduleColor(owner) : undefined) ?? theme.accent;
  }, [kind, theme.accent]);

  if (!renderer) {
    return (
      <GlassPanel style={{ padding: spacing.lg }}>
        <Caption>This card needs an app update to display.</Caption>
      </GlassPanel>
    );
  }
  return (
    <View style={[styles.cardAccent, { borderLeftColor: accent }]}>
      <LazyThunk thunk={renderer} props={{ payload, threadId, onSend }} />
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * Left edge only. The corner radius MUST equal the card's own (radius.lg):
   * the wrapper clips with overflow hidden, so a smaller radius here shaved
   * the card's 16pt corners with a 14pt mask and the coloured edge made its
   * own odd corner shape beside them — the mismatched corners the operator
   * pointed at. One radius, shared with the Card primitive, keeps the
   * coloured edge hugging the same curve as the card it belongs to.
   */
  cardAccent: {
    borderLeftWidth: 3,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    overflow: 'hidden',
  },
  fill: { flex: 1 },
  errorPanel: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  /* The colour lives on the edge, so the message itself can be plain ink. */
  errorStripe: { width: 3 },
  errorBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  centered: { alignItems: 'center', justifyContent: 'center' },
  // gap md → lg → xl: lg was reported as no better — each exchange needs
  // clear air around it before the thread stops reading as one column.
  thread: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
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
