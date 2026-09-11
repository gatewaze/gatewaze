/**
 * What sits where the text field was, for the length of a voice note.
 *
 * Recording: the waveform follows the microphone and a timer counts up, so a
 * person can see both that it is hearing them and how long they have been
 * going.
 *
 * Waiting for the transcript: the same bars, settled and dimmed, and nothing
 * else. There was a "Transcribing…" line here. It was a technical word for
 * something the member did not ask to think about, and it did not fit the
 * 74pt the timer occupies, so it wrapped onto two lines. The mic button turns
 * into a spinner for exactly this period, which already says the same thing.
 *
 * The words survive as an accessibility label, because a screen reader has no
 * spinner to look at.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Waveform } from '../components/Waveform';
import { Caption } from '../components/primitives';
import { useTheme } from '../theme/tokens';
import type { useVoiceInput } from './useVoiceInput';

export function VoiceIndicator({ voice }: { voice: ReturnType<typeof useVoiceInput> }) {
  const theme = useTheme();
  const recording = voice.state === 'recording';
  const mm = Math.floor(voice.seconds / 60);
  const ss = String(voice.seconds % 60).padStart(2, '0');

  return (
    <View
      style={styles.row}
      accessibilityLabel={recording ? 'Recording' : 'Turning your note into text'}
    >
      <Waveform
        style={[styles.wave, recording ? null : styles.settled]}
        metering={voice.metering}
        active={recording}
      />
      {/* The timer belongs to recording only. Dropping it once the note is
          sent lets the bars take the whole field rather than leaving a gap
          where a number used to be. */}
      {recording ? (
        <View style={styles.label}>
          <Caption style={{ color: theme.accent, fontVariant: ['tabular-nums'] }}>
            {`${mm}:${ss}`}
          </Caption>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  // The waveform takes the field; the timer sits at the right-hand end on a
  // fixed width so the bars do not reflow as the seconds tick over.
  wave: { flex: 1 },
  /** Captured, not listening. Reads as paused rather than as broken. */
  settled: { opacity: 0.45 },
  label: { width: 74, alignItems: 'flex-end' },
});
