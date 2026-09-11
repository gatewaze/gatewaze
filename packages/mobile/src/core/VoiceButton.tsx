/**
 * The microphone button, handling both of the ways people expect it to work.
 *
 * Some reach for it expecting a walkie-talkie: press, speak, release. Others
 * expect a toggle: tap to start, tap again to stop. Rather than picking one
 * and teaching the other half they are wrong, the gesture decides. Recording
 * begins the moment the finger lands either way, so nothing is lost while the
 * button works out which it is.
 *
 *   released within a second  → a tap. Recording continues; the next tap ends it.
 *   held longer               → push to talk. Releasing ends it.
 *
 * The threshold is deliberately generous. A hesitant tap is common and should
 * not silently become a half-second recording of nothing.
 */

import React, { useCallback, useRef } from 'react';
import { CircleButton } from '../components/ComposerControls';

/** Below this, a press reads as a tap rather than a hold. */
const HOLD_MS = 1000;

export function VoiceButton({ voice }: { voice: ReturnType<typeof import('./useVoiceInput').useVoiceInput> }) {
  const pressedAt = useRef<number | null>(null);
  // Whether THIS press is the one that started recording. Without it the tap
  // path breaks: the press that begins a recording is followed immediately by
  // its own release, which would read as the tap meant to stop it.
  const startedHere = useRef(false);

  const onPressIn = useCallback(() => {
    if (voice.state === 'idle') {
      startedHere.current = true;
      pressedAt.current = Date.now();
      void voice.start();
    } else {
      startedHere.current = false;
    }
  }, [voice]);

  const onPressOut = useCallback(() => {
    const held = pressedAt.current ? Date.now() - pressedAt.current : 0;
    pressedAt.current = null;

    if (startedHere.current) {
      // Held long enough to be push-to-talk, so releasing ends it. A quicker
      // release was a tap, and recording carries on until the next one.
      if (held >= HOLD_MS && voice.state === 'recording') void voice.stop();
      return;
    }
    // A press that did not start the recording is the tap that ends it.
    if (voice.state === 'recording') void voice.stop();
  }, [voice]);

  return (
    <CircleButton
      icon={voice.state === 'recording' ? 'stop' : 'microphone'}
      onPress={() => {}}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      // Held through the whole upload, so the spinner stays until the text
      // actually arrives rather than until the recording stops.
      busy={voice.state === 'uploading'}
      disabled={voice.state === 'uploading'}
      active={voice.state === 'recording'}
      prominent
    />
  );
}
