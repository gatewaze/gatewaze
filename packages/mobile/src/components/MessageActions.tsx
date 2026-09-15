/**
 * The bar that appears when a message is held down.
 *
 * ── WHY A BAR AND NOT A SHEET ─────────────────────────────────────────────
 *
 * There are at most two actions and the member is already looking at the
 * message they pressed. A modal sheet would cover the thing being acted on,
 * which is the one piece of context that makes "delete" safe to press.
 *
 * ── WHY DELETE HAS NO CONFIRMATION ────────────────────────────────────────
 *
 * It takes a deliberate press-and-hold to get here, the bar names the action
 * plainly, and the message is still on screen underneath it. A confirmation
 * on top of a long-press is two dialogs for one intent. The cost of a mistake
 * is one message in the member's own conversation, not anybody else's data.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Icon } from './Icon';
import { useTheme, radius, spacing, type } from '../theme/tokens';

export interface MessageAction {
  id: 'edit' | 'delete';
  label: string;
  icon: string;
  /** Drawn in the danger colour, for the one that removes something. */
  destructive?: boolean;
}

export function MessageActions({
  actions,
  onPick,
  onDismiss,
  align = 'left',
}: {
  actions: MessageAction[];
  onPick: (id: MessageAction['id']) => void;
  onDismiss: () => void;
  /** Sits under the message it belongs to, on the same side. */
  align?: 'left' | 'right';
}) {
  const theme = useTheme();
  if (!actions.length) return null;

  return (
    <>
      {/*
        A full-screen catcher BEHIND the bar, so a tap anywhere else closes it
        without also pressing whatever was tapped. Rendered first so the bar
        draws above it.
      */}
      <Pressable style={styles.catcher} onPress={onDismiss} accessibilityLabel="Dismiss" />
      <Animated.View
        entering={FadeIn.duration(140)}
        exiting={FadeOut.duration(120)}
        style={[
          styles.bar,
          {
            alignSelf: align === 'right' ? 'flex-end' : 'flex-start',
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        {actions.map((a, i) => (
          <React.Fragment key={a.id}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: theme.border }]} /> : null}
            <Pressable
              onPress={() => onPick(a.id)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Icon
                name={a.icon}
                size={16}
                color={a.destructive ? theme.danger : theme.text}
              />
              <Text style={[type.button, { color: a.destructive ? theme.danger : theme.text }]}>
                {a.label}
              </Text>
            </Pressable>
          </React.Fragment>
        ))}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  catcher: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  bar: {
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    overflow: 'hidden',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 40,
  },
  divider: { width: 1, alignSelf: 'stretch' },
});
