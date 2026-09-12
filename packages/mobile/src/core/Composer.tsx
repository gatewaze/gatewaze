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

import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { GlassPanel } from '../components/GlassPanel';
import { ModePill } from '../components/ComposerControls';
import { ComposerFade } from '../components/ComposerFade';
import { useCyclingPrompt } from './useCyclingPrompt';
import { coachPrompts, onCoachPromptsChange } from './coachPrompts';
import { useVoiceInput } from './useVoiceInput';
import { VoiceButton } from './VoiceButton';
import { VoiceIndicator } from './VoiceIndicator';
import { composerModes, photoKinds } from './registry';
import { useTheme, spacing, radius, layout, motion, easing as easingToken, type } from '../theme/tokens';

/**
 * The core's own camera mode key.
 *
 * Namespaced like a module's so it can never collide with one, but owned
 * here: see the note by `hasCamera`.
 */
export const CAMERA_MODE = 'core:camera';

/** What the field says when nothing has been typed and no mode is open. */
export const COMPOSER_PLACEHOLDER = 'Ask me anything...';

const EASE = Easing.bezier(easingToken.x1, easingToken.y1, easingToken.x2, easingToken.y2);

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
  /**
   * The camera is the core's own mode, not a module's.
   *
   * Food, body and medication photos each belong to a different module, and
   * no module can offer a camera that reaches the others. So the core owns
   * one camera and the modules say what a photo can be OF, through
   * `photoKinds`. The pill appears only when something has offered a kind.
   */
  const hasCamera = photoKinds().length > 0;

  const voice = useVoiceInput({
    useCase: 'health-coach-dictation',
    onTranscript: (text) =>
      onChangeDraft(draft.trim() ? `${draft.trim()} ${text}` : text),
  });

  /**
   * How far the panel sits above the bottom of the screen at rest.
   *
   * It has to clear two things. The home indicator is the obvious one. The
   * other is the display's own corner curve: the panel is inset 12pt from
   * each side, and at that x the curve has already risen about 21pt, so a
   * smaller value has the panel's bottom corners cut off by the hardware.
   * A device with no indicator has square enough corners not to need it.
   */
  const restPad = Math.max(layout.composerPadBottom, insets.bottom - spacing.md);

  // KeyboardAvoidingView measures the wrong frame under an ancestor
  // transform, and the drawer host applies one. Reanimated's keyboard height
  // is immune to that.
  const keyboard = useAnimatedKeyboard();
  const shift = useAnimatedStyle(() => {
    const k = keyboard.height.value;
    // The keyboard's height already includes the safe area, and it covers the
    // curve, so the clearance above is not needed while it is open. Giving it
    // back keeps the panel sitting on the keyboard instead of floating over
    // it. Done on the transform rather than by animating paddingBottom, which
    // reanimated applies without a fresh layout pass.
    return { transform: [{ translateY: k > 0 ? -(k - (restPad - layout.composerPadBottom)) : 0 }] };
  });

  // The openers the coach offers, which are whatever module drives it. An
  // empty list simply means the static placeholder stands.
  const [prompts, setPrompts] = useState<string[]>(() => coachPrompts());
  useEffect(() => onCoachPromptsChange(setPrompts), []);

  // A caller-supplied placeholder is a statement about the current mode, e.g.
  // 'Search the food database', so it wins over the cycle.
  const cycling = placeholder === COMPOSER_PLACEHOLDER && prompts.length > 0;
  const prompt = useCyclingPrompt(cycling ? prompts : []);

  // The adopt arrow belongs to a FINISHED sentence, and fades rather than
  // toggling: tying it to the keystrokes made it blink on and off.
  const arrow = useSharedValue(0);
  useEffect(() => {
    arrow.value = withTiming(prompt.complete ? 1 : 0, { duration: motion.quick, easing: EASE });
  }, [prompt.complete, arrow]);
  const arrowStyle = useAnimatedStyle(() => ({ opacity: arrow.value }));

  /**
   * A capture mode owns the screen, and the field must give up focus for it.
   *
   * The coach already calls Keyboard.dismiss() when a mode opens, and that is
   * not enough on its own: dismissing hides the keyboard while the field
   * stays focused, so the next tap anywhere — including on the scanner —
   * brings it straight back up over the camera. Blur actually surrenders it.
   *
   * This lives here rather than in the caller because the composer owns the
   * field, and the caller has no handle on it to blur.
   */
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (activeMode === null) return;
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, [activeMode]);

  const canSend = Boolean(draft.trim()) && !busy;

  return (
    <Animated.View
      style={[styles.wrap, { paddingBottom: restPad }, zIndex === undefined ? null : { zIndex }, shift]}
      // The composer floats over the destination's own content. Only the
      // panel should take touches, or the whole strip would swallow taps
      // meant for the list underneath it.
      pointerEvents="box-none"
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
    >
      {/* Fills this whole area, under the panel. Content dissolves into it on
          the way down and is hidden from there, rather than staying legible
          through the glass and reappearing below it. */}
      <ComposerFade />
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
            <View style={styles.fieldWrap}>
              <TextInput
                ref={inputRef}
                // Never while a mode surface is up: the camera and the scanner
                // need the whole screen, and a keyboard over them is the one
                // thing that makes them unusable.
                autoFocus={autoFocus && activeMode === null}
                value={draft}
                onChangeText={onChangeDraft}
                // The cycling suggestion IS the placeholder, rather than
                // something drawn over it. Same view, same font, same line as
                // the text that replaces it, so adopting one cannot make the
                // words move.
                placeholder={cycling ? prompt.text : placeholder}
                placeholderTextColor={theme.textMuted}
                multiline
                style={[type.chat, styles.input, { color: theme.text }]}
              />
              {/* The one thing that adopts the suggestion, at the far end of
                  the field and well away from where a caret tap lands. The
                  words themselves are the field's own placeholder and cannot
                  be tapped at all, so tapping the text just puts the caret
                  there, which is what someone typing their own question
                  expects. */}
              {cycling ? (
                <Animated.View
                  style={[styles.adopt, arrowStyle]}
                  pointerEvents={prompt.complete ? 'auto' : 'none'}
                >
                  <Pressable
                    onPress={() => onChangeDraft(prompt.full)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Ask: ${prompt.full}`}
                  >
                    <Icon name="arrow-up" size={15} color={theme.textMuted} />
                  </Pressable>
                </Animated.View>
              ) : null}
            </View>
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
              {hasCamera ? (
                <ModePill
                  icon="camera"
                  label="Photo"
                  active={activeMode === CAMERA_MODE}
                  onPress={() => onSelectMode(activeMode === CAMERA_MODE ? null : CAMERA_MODE)}
                />
              ) : null}
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
            <Icon name="arrow-up" size={21} color={theme.onAccent} />
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
    // The design's `padding: 26px 12px 10px`. The fade spans this whole area,
    // so the top padding is the stretch where it is still nearly transparent
    // and content above the composer stays readable.
    paddingTop: layout.composerPadTop,
    paddingHorizontal: layout.composerMargin,
    // paddingBottom is applied inline; it depends on the safe-area inset.
  },
  // Roomier than the original: the prompt needs air above and below.
  inputRow: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  input: { minHeight: 40, maxHeight: 120, paddingVertical: 8 },
  fieldWrap: {},
  // Centred on the field, which is one line high whenever a suggestion is
  // showing: a suggestion only appears on an empty field.
  adopt: { position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center' },
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
    // Uniform, so the active pill sits in an even margin. Splitting this into
    // 9 horizontal and 3 vertical gave the white pill three times more room
    // beside it than above it, which reads as a mistake however much the end
    // pills needed the space. 6 all round is the compromise: double the
    // original clearance at the ends, and square.
    padding: 6,
  },
  send: {
    width: layout.tapTarget,
    height: layout.tapTarget,
    borderRadius: layout.tapTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
