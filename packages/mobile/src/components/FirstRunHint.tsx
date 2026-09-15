/**
 * The one tooltip that cannot be driven by the chat.
 *
 * Everything else the app wants to point out, the assistant can mention in a
 * message — that is the whole design. This one cannot: a member who does not
 * know how to send a message cannot be told how to by message. So it is
 * client-side, it fires on first launch, and it sits above the composer
 * pointing at the thing it is describing.
 *
 * ── WHY IT DISMISSES ON USE, NOT ON "GOT IT" ──────────────────────────────
 *
 * It goes away when the member focuses the field, not when they tap a button.
 * The goal is the first message, not the acknowledgement — and a tooltip you
 * dismiss without touching anything has taught nobody anything. Tapping it
 * also dismisses, because a tooltip you cannot get rid of is worse than one
 * that closes too eagerly.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Body, Caption } from './primitives';
import { useTheme, radius, spacing } from '../theme/tokens';

/** Shown once, ever. Per install, which is the right grain for a hint. */
const SEEN_KEY = 'gatewaze:first-run:composer-hint';

const TAIL_W = 22;
const TAIL_H = 11;
const R = radius.lg;
const STROKE = 1;

/**
 * Bubble and tail as ONE path, which is the whole reason this is SVG.
 *
 * The obvious build — a rounded View with a triangle under it — cannot work
 * here, because both bubble colours are semi-transparent. A triangle made of
 * two stacked Views paints the fill ON TOP of the border shape, so the tail's
 * interior ends up dark-over-white while the bubble's interior is dark-over-
 * whatever is behind the app. Same colour values, visibly different result,
 * and the doubled edges read as a thicker border. One path gets exactly one
 * fill and one stroke everywhere, so the tail cannot drift from the body.
 *
 * Inset by half the stroke: SVG centres a stroke on the path, so a path at
 * the very edge would have half its outline clipped off.
 */
function bubblePath(w: number, h: number) {
  const i = STROKE / 2;
  const cx = w / 2;
  const bottom = h - i;
  return [
    `M ${R + i} ${i}`,
    `H ${w - R - i}`,
    `A ${R} ${R} 0 0 1 ${w - i} ${R + i}`,
    `V ${bottom - R}`,
    `A ${R} ${R} 0 0 1 ${w - R - i} ${bottom}`,
    // Out along the bottom edge, down to the point, back up. The bottom edge
    // is simply interrupted here, which is what makes the tail part of the
    // bubble rather than an arrow parked beneath it.
    `H ${cx + TAIL_W / 2}`,
    `L ${cx} ${bottom + TAIL_H}`,
    `L ${cx - TAIL_W / 2} ${bottom}`,
    `H ${R + i}`,
    `A ${R} ${R} 0 0 1 ${i} ${bottom - R}`,
    `V ${R + i}`,
    `A ${R} ${R} 0 0 1 ${R + i} ${i}`,
    'Z',
  ].join(' ');
}

export function FirstRunHint({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const theme = useTheme();
  const [ready, setReady] = useState(false);
  const [seen, setSeen] = useState(true);
  // The path needs real pixels, so it is drawn on the second pass once the
  // text has told us how big the bubble is.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((v) => { if (alive) { setSeen(Boolean(v)); setReady(true); } })
      // Storage failing is not a reason to nag somebody forever, so an
      // unreadable flag is treated as "already seen".
      .catch(() => { if (alive) { setSeen(true); setReady(true); } });
    return () => { alive = false; };
  }, []);

  const dismiss = () => {
    setSeen(true);
    AsyncStorage.setItem(SEEN_KEY, new Date().toISOString()).catch(() => undefined);
    onDismiss();
  };

  if (!ready || seen || !visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(320).delay(700)}
      exiting={FadeOut.duration(160)}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <Pressable onPress={dismiss} style={styles.bubble} onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
      }}>
        {box ? (
          <Svg
            width={box.w}
            height={box.h + TAIL_H + STROKE}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            <Path
              d={bubblePath(box.w, box.h)}
              fill={theme.buttonFill}
              stroke={theme.buttonBorder}
              strokeWidth={STROKE}
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
        <View style={styles.content}>
          <Body style={{ color: theme.buttonText, fontWeight: '700' }}>This is how you talk to me</Body>
          <Caption style={{ color: theme.buttonText, opacity: 0.85 }}>
            Type here and hit send. You can also hold the mic to talk, or use the
            camera to photograph a meal.
          </Caption>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** For a Settings "show me around again" control, later. */
export async function resetFirstRunHint() {
  await AsyncStorage.removeItem(SEEN_KEY).catch(() => undefined);
}

const styles = StyleSheet.create({
  // Room under the bubble for the tail to draw into without being clipped.
  wrap: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: TAIL_H + STROKE },
  // No background or border here any more — the path is the skin. This View
  // only decides how big that path has to be.
  bubble: { maxWidth: 340 },
  content: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
});
