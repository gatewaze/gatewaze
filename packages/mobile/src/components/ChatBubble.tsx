/**
 * Chat bubbles and quick-reply chips.
 *
 * The coach's most recent message carries a slow teal glow ("presence" in
 * the design). A message still being generated shows a distinct pending
 * state instead, because real replies take seconds — the design assumed
 * instant scripted replies.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeInDown,
  ReduceMotion,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  withDelay,
} from 'react-native-reanimated';
import { useTheme, bubbleRadius, radius, spacing, type, motion } from '../theme/tokens';

export function ChatBubble({
  role,
  children,
  latestCoach = false,
  pending = false,
  status = null,
  style,
}: {
  role: 'member' | 'coach';
  children: React.ReactNode;
  /** The newest coach message glows gently. */
  latestCoach?: boolean;
  pending?: boolean;
  /** What the app is doing, shown under the dots if the wait runs long. */
  status?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const glow = useSharedValue(0);

  // A lub-dub, not a throb: two quick beats then a long rest, with the glow
  // at exactly zero in between.
  useEffect(() => {
    if (!latestCoach || pending) {
      glow.value = 0;
      return;
    }
    glow.value = withRepeat(
      withSequence(
        // lub, the full-strength beat
        withTiming(1, { duration: LUB_RISE, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: LUB_FALL, easing: Easing.in(Easing.quad) }),
        // dub, quieter
        withTiming(DUB_PEAK, { duration: DUB_RISE, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: DUB_FALL, easing: Easing.in(Easing.quad) }),
        // rest
        withTiming(0, { duration: motion.heartbeatRest })
      ),
      -1,
      false
    );
  }, [latestCoach, pending, glow]);

  // iOS derives the old shadowOpacity/shadowRadius from the layer's alpha
  // silhouette, and these bubbles are a 14%-alpha fill, so those props
  // render essentially nothing however high they are set. RN 0.83 on the
  // New Architecture supports the CSS `boxShadow` instead, which is a real
  // Gaussian blur drawn from the border box. That gives a smooth falloff
  // rather than the banding of stacked layers, and because an outer shadow
  // is clipped to outside the border box it never tints the bubble's own
  // background.
  //
  // The beat drives the blur radius, so the edge radiates in and out while
  // the border colour and the fill both stay constant.
  const rgb = rgbTriplet(theme.coach);
  const glowStyle = useAnimatedStyle(() => ({
    // Two shadows, comma separated: the drop shadow that holds the bubble off
    // the background, and the beat on top of it. Setting only the beat here
    // would replace the drop shadow on the newest message, so the one bubble
    // the eye is on would be the one lying flat.
    boxShadow:
      `${DROP_SHADOW}, 0px 0px ${2 + glow.value * 17}px rgba(${rgb}, ${0.07 + glow.value * 0.33})`,
  }));

  const isCoach = role === 'coach';
  const showGlow = isCoach && latestCoach && !pending;

  /**
   * The coach's bubbles arrive; the member's are just there.
   *
   * A reply that snaps into existence reads as a page redraw rather than
   * somebody answering, so it fades up over a short distance — enough to say
   * "this is new", not enough to make the member wait for it.
   *
   * ── WHY THE MEMBER'S BUBBLE IS NOT ANIMATED ───────────────────────────────
   *
   * Their message must appear the instant they press send, with no fade at
   * all; anything else makes the app feel like it is thinking about whether to
   * accept it. There is also a mechanical reason: when the reply lands, the
   * thread is replaced with the server's rows, so the optimistic bubble
   * unmounts and a new one mounts under its real id. An entering animation
   * would re-run there, flickering the member's own words at the exact moment
   * they are reading the answer.
   *
   * Decorative, so it respects Reduce Motion by default — unlike the typing
   * dots, which carry information and deliberately do not.
   */
  const entering = isCoach
    ? FadeInDown.duration(260).withInitialValues({ transform: [{ translateY: 10 }] })
    : undefined;

  return (
    <Animated.View
      entering={entering}
      style={[
        styles.bubble,
        isCoach ? bubbleRadius.coach : bubbleRadius.member,
        {
          alignSelf: isCoach ? 'flex-start' : 'flex-end',
          backgroundColor: isCoach ? theme.bubbleCoach : theme.bubbleMember,
          borderColor: isCoach ? theme.bubbleBorderCoach : theme.bubbleBorderMember,
        },
        showGlow && glowStyle,
        style,
      ]}
    >
      {pending ? (
        <PendingDots status={status} />
      ) : typeof children === 'string' ? (
        <Text
          style={[
            type.chat,
            // Per role: a filled coach bubble needs ink that reads against the
            // fill, and an outlined member bubble needs text that reads against
            // whatever is drifting behind it.
            { color: isCoach ? theme.bubbleTextCoach : theme.bubbleTextMember },
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Animated.View>
  );
}

/** A colour's "r, g, b" components, accepting hex or rgb()/rgba() input. */
function rgbTriplet(color: string): string {
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) return rgb[1].split(',').slice(0, 3).map((n) => n.trim()).join(', ');
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
  const parts = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return parts.some(Number.isNaN) ? '255, 255, 255' : parts.join(', ');
}

/**
 * The lub-dub, in milliseconds, from the shared motion tokens.
 *
 * These are absolute rather than a share of the cycle. Deriving them from
 * the cycle length tied the beat's speed to the gap between beats, so making
 * the coach calmer by lengthening the gap also made each beat slow and
 * laboured. The beats stay quick and the gap alone sets the mood.
 *
 * They moved into tokens once the arriving-reply haptic began tapping in
 * time with this glow — one source, so the felt beat and the seen beat
 * cannot drift apart.
 */
const { lubRise: LUB_RISE, lubFall: LUB_FALL, dubRise: DUB_RISE, dubFall: DUB_FALL } = motion.heartbeat;

/** The second beat is weaker than the first, as in a real heartbeat. */
const DUB_PEAK = 0.6;

/**
 * The drop shadow that lifts a bubble off the background.
 *
 * `boxShadow` rather than the legacy shadow props, and not by preference: iOS
 * derives shadowOpacity/shadowRadius from the layer's ALPHA SILHOUETTE, and
 * these bubbles are a translucent fill, so those props render essentially
 * nothing however high they are set. boxShadow is a real Gaussian blur drawn
 * from the border box, which is what a translucent card needs.
 *
 * Large and soft, offset downward: a big blur with a small offset reads as
 * height above the background, where a tight dark edge reads as a sticker cut
 * out and laid on it.
 */
const DROP_SHADOW = '0px 12px 28px rgba(0, 0, 0, 0.38)';

/**
 * One dot of the typing wave.
 *
 * Each dot runs the SAME cycle offset by a phase delay, which is what makes
 * three dots read as one travelling wave rather than three blinkers. The
 * cycle is a quick rise with a slower settle and then a rest, so the wave
 * sweeps across and pauses — the rhythm of typing, not a metronome.
 */
function WaveDot({ delay, color }: { delay: number; color: string }) {
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 260, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.Never }),
          withTiming(0, { duration: 340, easing: Easing.in(Easing.quad), reduceMotion: ReduceMotion.Never }),
          // The rest between sweeps. Long enough that the wave is an event
          // with a beginning, not a permanent shimmer.
          withTiming(0, { duration: 520, reduceMotion: ReduceMotion.Never })
        ),
        -1,
        false,
        undefined,
        // A frozen typing indicator reads as the coach having died mid-reply.
        // The wave is small and communicates live progress, so it runs under
        // Reduce Motion, like the system's own typing indicators.
        ReduceMotion.Never
      )
    );
  }, [delay, lift]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value * 5 }],
    opacity: 0.45 + lift.value * 0.55,
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/**
 * How long a reply has to be taking before it explains itself.
 *
 * Under this, a status line is noise: the answer arrives before anybody has
 * finished reading why they are waiting, and a label that flashes up and
 * vanishes is worse than none. Most replies land in about two seconds, so
 * this shows up only for the ones that genuinely make you wait.
 */
const STATUS_AFTER_MS = 2000;

/** Milliseconds per character, in and out. Fast enough not to be the wait. */
const TYPE_IN_MS = 28;
const TYPE_OUT_MS = 14;

/**
 * A line of text that types itself in, and back out again when it changes.
 *
 * Deliberately character-by-character rather than a fade: the point is to look
 * like something is being worked out, and a fade reads as a label appearing
 * rather than as progress.
 */
function Typewriter({ text, color }: { text: string | null; color: string }) {
  const [shown, setShown] = useState('');
  // What is currently being typed out or in, so a change mid-type reverses
  // cleanly instead of interleaving two words.
  const target = useRef<string | null>(null);

  useEffect(() => {
    target.current = text;
    let timer: ReturnType<typeof setTimeout>;

    const step = () => {
      setShown((current) => {
        const want = target.current ?? '';
        if (current === want) return current;
        // Type OUT first whenever the current text is not a prefix of the
        // wanted one — you cannot type "Searching" into "Reading" without
        // clearing it.
        if (!want.startsWith(current)) {
          timer = setTimeout(step, TYPE_OUT_MS);
          return current.slice(0, -1);
        }
        timer = setTimeout(step, TYPE_IN_MS);
        return want.slice(0, current.length + 1);
      });
    };

    step();
    return () => clearTimeout(timer);
  }, [text]);

  if (!shown) return null;
  return (
    /* 0.9, not 0.75: at 0.75 this measured 4.77:1 against the dimmest bubble
       fill, which clears the 4.5 minimum with almost nothing to spare. It is
       secondary text, so it stays below full strength, but not so far below
       that a slightly darker fill would push it under. */
    <Text style={[type.caption, { color, opacity: 0.9 }]} numberOfLines={2}>
      {shown}
    </Text>
  );
}

/**
 * Shown while the coach is composing a reply.
 *
 * `status` is what the app KNOWS it asked for — reading a photo, searching the
 * food database — never a guess at what the model is thinking. When there is
 * nothing honest to say it stays as dots, which is why the prop is optional
 * rather than defaulted to something vague.
 */
function PendingDots({ status = null }: { status?: string | null }) {
  const theme = useTheme();
  const [late, setLate] = useState(false);

  useEffect(() => {
    if (!status) return undefined;
    const t = setTimeout(() => setLate(true), STATUS_AFTER_MS);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <Animated.View style={styles.pending}>
      <Animated.View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <WaveDot
            key={i}
            delay={i * 140}
            /* The bubble's own ink, not the coach accent. The dots live INSIDE
               the coach bubble, which is white since the bubble retheme, and the
               old coach green was near-invisible against it — the same
               fill-vs-ink rule the bubble text itself follows. */
            color={theme.bubbleTextCoach}
          />
        ))}
      </Animated.View>
      <Typewriter text={late ? status : null} color={theme.bubbleTextCoach} />
    </Animated.View>
  );
}

/**
 * A selectable chip. Unlike SuggestionChip, which is a one-shot action in a
 * thread, this one holds a state: it is used for multi-select sets like a
 * day's triggers, and for single-select ranges like a chart window.
 */
export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? theme.accent : theme.controlBorder,
          backgroundColor: selected ? theme.accentSoft : theme.controlFill,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[type.button, { color: selected ? theme.accent : theme.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SuggestionChip({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        /* Dark glass, light edge: the accent fill read as lilac on the mesh. */
        { borderColor: theme.buttonBorder, backgroundColor: theme.buttonFillSoft, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[type.button, { color: theme.buttonText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '86%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    boxShadow: DROP_SHADOW,
  },
  /* The wave only travels UP from rest (translateY 0 → -5), so with equal
     padding the cluster's motion band sat high in the bubble. Headroom above
     and rest near the bottom centres the band. */
  dots: { flexDirection: 'row', gap: 4, paddingTop: 7, paddingBottom: 2 },
  /* The bubble grows downward to make room for the status line, so the dots
     stay where they were rather than jumping when the text appears. */
  pending: { gap: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chip: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 36,
    justifyContent: 'center',
  },
});
