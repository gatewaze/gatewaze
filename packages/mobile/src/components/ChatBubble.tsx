/**
 * Chat bubbles and quick-reply chips.
 *
 * The coach's most recent message carries a slow teal glow ("presence" in
 * the design). A message still being generated shows a distinct pending
 * state instead, because real replies take seconds — the design assumed
 * instant scripted replies.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
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
  style,
}: {
  role: 'member' | 'coach';
  children: React.ReactNode;
  /** The newest coach message glows gently. */
  latestCoach?: boolean;
  pending?: boolean;
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
    boxShadow: `0px 0px ${2 + glow.value * 17}px rgba(${rgb}, ${0.07 + glow.value * 0.33})`,
  }));

  const isCoach = role === 'coach';
  const showGlow = isCoach && latestCoach && !pending;

  return (
    <Animated.View
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
        <PendingDots />
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
 * The lub-dub, in milliseconds.
 *
 * These are absolute rather than a share of the cycle. Deriving them from
 * the cycle length tied the beat's speed to the gap between beats, so making
 * the coach calmer by lengthening the gap also made each beat slow and
 * laboured. The beats stay quick and the gap alone sets the mood.
 */
const LUB_RISE = 77;
const LUB_FALL = 77;
const DUB_RISE = 88;
const DUB_FALL = 110;

/** The second beat is weaker than the first, as in a real heartbeat. */
const DUB_PEAK = 0.6;

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

/** Shown while the coach is composing a reply. */
function PendingDots() {
  const theme = useTheme();
  return (
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
  },
  dots: { flexDirection: 'row', gap: 4, paddingVertical: 2 },
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
