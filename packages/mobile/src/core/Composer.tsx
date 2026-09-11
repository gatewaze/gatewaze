/**
 * The composer, and the only one.
 *
 * It is docked at the bottom of the coach and of every other destination.
 * Those two were separate copies of the same JSX and the same six styles,
 * and they drifted the way copies do: different placeholder text, a mode
 * track that never showed a selection on one of them, and a fade that got
 * fixed in one and not the other. There is one of them now. What genuinely
 * differs between the two places is passed in.
 *
 * What this does NOT own is a conversation. It collects a message, a mode
 * choice or a voice note and hands them to its caller. On the coach the
 * caller sends them; everywhere else the caller leaves them for the coach
 * and moves there, so there is one thread and one place a reply arrives.
 */

import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { GlassPanel } from '../components/GlassPanel';
import { ModePill } from '../components/ComposerControls';
import { ComposerFade, COMPOSER_FADE_HEIGHT } from '../components/ComposerFade';
import { useVoiceInput } from './useVoiceInput';
import { VoiceButton } from './VoiceButton';
import { VoiceIndicator } from './VoiceIndicator';
import { composerModes } from './registry';
import { useTheme, spacing, radius, layout, type } from '../theme/tokens';

/** What the field says when nothing has been typed and no mode is open. */
export const COMPOSER_PLACEHOLDER = 'Ask me anything...';

const modeKey = (m: { moduleId: string; id: string }) => `${m.moduleId}:${m.id}`;

export function Composer({
  enabled,
  draft,
  onChangeDraft,
  activeMode,
  onSelectMode,
  onSend,
  placeholder = COMPOSER_PLACEHOLDER,
  busy = false,
  autoFocus = false,
  onHeight,
  zIndex,
}: {
  /** Which modules the member is entitled to, for the mode track. */
  enabled: Record<string, boolean>;
  draft: string;
  onChangeDraft: (text: string) => void;
  /** `null` is the chat mode, which is why it is not simply absent. */
  activeMode: string | null;
  onSelectMode: (key: string | null) => void;
  onSend: () => void;
  placeholder?: string;
  /** Blocks send while a reply is in flight. */
  busy?: boolean;
  autoFocus?: boolean;
  /** Measured height, so content underneath can clear it. */
  onHeight?: (h: number) => void;
  zIndex?: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const modes = composerModes(enabled);

  const voice = useVoiceInput({
    useCase: 'health-coach-dictation',
    onTranscript: (text) =>
      onChangeDraft(draft.trim() ? `${draft.trim()} ${text}` : text),
  });

  // KeyboardAvoidingView measures the wrong frame under an ancestor
  // transform, and the drawer host applies one. Reanimated's keyboard height
  // is immune to that.
  const keyboard = useAnimatedKeyboard();
  const shift = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));

  const canSend = Boolean(draft.trim()) && !busy;

  return (
    <Animated.View
      style={[
        styles.wrap,
        // Clears the home indicator. The coach's copy used a flat 10pt and
        // sat lower than the one on every other screen; this is the version
        // that leaves room, applied to both.
        { paddingBottom: insets.bottom + spacing.sm },
        zIndex === undefined ? null : { zIndex },
        shift,
      ]}
      // The composer floats over the destination's own content. Only the
      // panel should take touches, or the whole strip would swallow taps
      // meant for the list underneath it.
      pointerEvents="box-none"
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
    >
      {/* The strip below the panel is exactly the padding that clears the
          home indicator, which is the one gap content could show through. */}
      <ComposerFade bottom={insets.bottom + spacing.sm} />
      {/* One radius on all four corners. Matching the bottom pair to the
          display's own curve left them much rounder than the top pair,
          which read as lopsided; an even shape looks better than a
          concentric one here. */}
      <GlassPanel radius={radius.composer}>
        <View style={styles.inputRow}>
          {/* The field gives way to the waveform for the whole of a voice
              note, and stays gone until the transcript lands, so the row
              never jumps and there is always something saying what is
              happening. */}
          {voice.state === 'idle' ? (
            <TextInput
              // Development affordance: focus on mount so keyboard-avoidance
              // can be inspected without driving the simulator by hand.
              autoFocus={autoFocus}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder={placeholder}
              placeholderTextColor={theme.textMuted}
              multiline
              style={[type.chat, styles.input, { color: theme.text }]}
            />
          ) : (
            <VoiceIndicator voice={voice} />
          )}
        </View>

        <View style={styles.toolbar}>
          {modes.length > 0 ? (
            <View
              style={[
                styles.track,
                { backgroundColor: theme.controlFill, borderColor: 'rgba(255,255,255,0.12)' },
              ]}
            >
              <ModePill
                icon="message-outline"
                label="Chat"
                active={activeMode === null}
                onPress={() => onSelectMode(null)}
              />
              {modes.map((m) => (
                <ModePill
                  key={modeKey(m)}
                  icon={m.icon}
                  label={m.label}
                  active={activeMode === modeKey(m)}
                  onPress={() => onSelectMode(activeMode === modeKey(m) ? null : modeKey(m))}
                />
              ))}
            </View>
          ) : null}

          <VoiceButton voice={voice} />
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            style={[styles.send, { backgroundColor: theme.accent, opacity: canSend ? 1 : 0.4 }]}
          >
            <Icon name="arrow-up" size={18} color={theme.onAccent} />
          </Pressable>
        </View>
      </GlassPanel>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Matches the fade's height so the gradient fills the gap above the
    // panel exactly, with no overlap onto the glass.
    paddingTop: COMPOSER_FADE_HEIGHT,
    paddingHorizontal: layout.composerMargin,
    // paddingBottom is applied inline from the safe-area inset.
  },
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
  track: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    padding: 3,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
