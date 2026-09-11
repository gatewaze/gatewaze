/**
 * What sits where the text field was, for the length of a voice note.
 *
 * Two states, and both need to be legible at a glance. While recording, the
 * waveform follows the microphone and a timer counts up, so a person can see
 * both that it is hearing them and how long they have been going. While the
 * transcript is on its way back, the bars stop and the line says so — the
 * alternative, an empty field, reads as nothing having happened.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Waveform } from '../components/Waveform';
import { Caption } from '../components/primitives';
import { useTheme, spacing, type } from '../theme/tokens';
import type { useVoiceInput } from './useVoiceInput';

export function VoiceIndicator({ voice }: { voice: ReturnType<typeof useVoiceInput> }) {
  const theme = useTheme();
  const recording = voice.state === 'recording';
  const mm = Math.floor(voice.seconds / 60);
  const ss = String(voice.seconds % 60).padStart(2, '0');

  return (
    <View style={styles.row}>
      <Waveform metering={voice.metering} active={recording} />
      <View style={styles.label}>
        {recording ? (
          <Caption style={{ color: theme.accent, fontVariant: ['tabular-nums'] }}>
            {`${mm}:${ss}`}
          </Caption>
        ) : (
          <Caption style={{ color: theme.textMuted }}>Transcribing…</Caption>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
  },
  label: { minWidth: 74, alignItems: 'flex-end' },
});
