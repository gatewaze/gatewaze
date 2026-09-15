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
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Body, Caption } from './primitives';
import { Icon } from './Icon';
import { useTheme, radius, spacing } from '../theme/tokens';

/** Shown once, ever. Per install, which is the right grain for a hint. */
const SEEN_KEY = 'gatewaze:first-run:composer-hint';

export function FirstRunHint({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const theme = useTheme();
  const [ready, setReady] = useState(false);
  const [seen, setSeen] = useState(true);

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
      <Pressable onPress={dismiss} style={[styles.bubble, { backgroundColor: theme.buttonFill, borderColor: theme.buttonBorder }]}>
        <Body style={{ color: theme.buttonText, fontWeight: '700' }}>This is how you talk to me</Body>
        <Caption style={{ color: theme.buttonText, opacity: 0.85 }}>
          Type here and hit send. You can also hold the mic to talk, or use the
          camera to photograph a meal.
        </Caption>
      </Pressable>
      {/* The pointer, so it reads as attached to the bar rather than floating
          above it. */}
      <View style={styles.arrowRow} pointerEvents="none">
        <Icon name="chevron-down" size={20} color={theme.buttonBorder} />
      </View>
    </Animated.View>
  );
}

/** For a Settings "show me around again" control, later. */
export async function resetFirstRunHint() {
  await AsyncStorage.removeItem(SEEN_KEY).catch(() => undefined);
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: spacing.lg },
  bubble: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    maxWidth: 340,
  },
  arrowRow: { marginTop: -2 },
});
