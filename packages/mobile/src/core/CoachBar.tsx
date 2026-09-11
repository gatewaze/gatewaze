/**
 * The composer as it appears on every destination that is not the coach.
 *
 * The member asked to be able to talk to the coach from anywhere, so the field
 * and the mode track are present at the bottom of every screen. What this bar
 * does NOT do is own a conversation: it collects a message or a mode choice
 * and hands both to the coach, which is where the thread, the send queue and
 * the mode surfaces already live. Pressing send moves to the coach and the
 * message goes out there, so there is one thread and one place a reply can
 * arrive.
 *
 * It looks like the real composer because it is the same panel and the same
 * mode pills. The difference is that it never renders a mode surface itself.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { GlassPanel } from '../components/GlassPanel';
import { ModePill } from './CoachHome';
import { composerModes } from './registry';
import { requestCoachHandoff } from './coachHandoff';
import { useTheme, spacing, radius, layout, type } from '../theme/tokens';
import { useVoiceInput } from './useVoiceInput';
import { VoiceButton } from './VoiceButton';
import { VoiceIndicator } from './VoiceIndicator';
import { ComposerFade, COMPOSER_FADE_HEIGHT } from '../components/ComposerFade';
import { CircleButton } from './CoachHome';

export function CoachBar({
  enabled,
  onHandoff,
  onHeight,
}: {
  /** Which modules the member is entitled to, for the mode track. */
  enabled: Record<string, boolean>;
  /** Move to the coach. Called after the handover has been left. */
  onHandoff: () => void;
  /** Measured height, so the destination underneath can clear it. */
  onHeight?: (h: number) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const voice = useVoiceInput({
    useCase: 'health-coach-dictation',
    onTranscript: (text) => setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text)),
  });


  const modes = composerModes(enabled);
  const modeKey = (m: { moduleId: string; id: string }) => `${m.moduleId}:${m.id}`;

  // Same reason as the coach's own composer: an ancestor transform makes
  // KeyboardAvoidingView measure the wrong frame, and reanimated's keyboard
  // height is immune to that.
  const keyboard = useAnimatedKeyboard();
  const shift = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));

  /**
   * Leave the handover and move. `always` is for the pills, which are a
   * request to go to the coach whether or not anything has been typed; the
   * send button needs text before it does anything.
   */
  const hand = (mode: string | null, always = false) => {
    if (!always && !draft.trim()) return;
    requestCoachHandoff({ text: draft.trim(), mode });
    setDraft('');
    onHandoff();
  };

  return (
    <Animated.View
      style={[styles.wrap, { paddingBottom: insets.bottom + spacing.sm }, shift]}
      // The bar sits over the destination's own content. Only the panel
      // should take touches, or the whole strip would swallow taps meant for
      // the list underneath it.
      pointerEvents="box-none"
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
    >
      <ComposerFade />
      <GlassPanel radius={radius.composer} style={styles.panel}>
        <View style={styles.inputRow}>
          {voice.state === 'idle' ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask the coach..."
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
                active={false}
                onPress={() => hand(null, true)}
              />
              {modes.map((m) => (
                <ModePill
                  key={modeKey(m)}
                  icon={m.icon}
                  label={m.label}
                  active={false}
                  onPress={() => hand(modeKey(m), true)}
                />
              ))}
            </View>
          ) : null}

          <VoiceButton voice={voice} />
          <Pressable
            onPress={() => hand(null)}
            disabled={!draft.trim()}
            style={[
              styles.send,
              { backgroundColor: theme.accent, opacity: draft.trim() ? 1 : 0.4 },
            ]}
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
    paddingTop: COMPOSER_FADE_HEIGHT,
    paddingHorizontal: layout.composerMargin,
    paddingBottom: layout.composerPadBottom,
  },
  panel: {},
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
