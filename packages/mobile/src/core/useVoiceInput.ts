/**
 * The mic button's recorder (spec-ai-voice-transcription.md §3.4).
 *
 * The portal's `useVoiceInput` is the reference implementation and cannot be
 * vendored here: it is built on MediaRecorder and getUserMedia, neither of
 * which exists in React Native. The HTTP endpoint is the contract, so this is
 * the same shape with a different recorder — tap to record, tap to stop, post
 * the file, hand the transcript back for the caller to put in the draft.
 *
 * Deliberately boring. Everything clever about transcription happens on the
 * server, which chooses the provider, holds the credential and enforces the
 * per-use-case cap.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { getModuleContext } from './context';

export type VoiceState = 'idle' | 'recording' | 'uploading';

/** Matches the server's cap for this use case; it refuses longer anyway. */
const MAX_SECONDS = 120;

export function useVoiceInput({
  useCase,
  onTranscript,
}: {
  useCase: string;
  onTranscript: (text: string) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = useCallback(() => {
    if (tick.current) {
      clearInterval(tick.current);
      tick.current = null;
    }
  }, []);

  useEffect(() => clearTick, [clearTick]);

  const start = useCallback(async () => {
    setError(null);
    const granted = await requestRecordingPermissionsAsync();
    if (!granted.granted) {
      // Not an error state to shout about: they said no, which is allowed.
      setError('Microphone access is off. You can turn it on in Settings.');
      return;
    }
    // iOS silences playback and routes correctly only once the mode is set.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setSeconds(0);
    setState('recording');
    tick.current = setInterval(() => {
      setSeconds((s) => {
        // Stop rather than let the server reject a file it already received.
        if (s + 1 >= MAX_SECONDS) void stop();
        return s + 1;
      });
    }, 1000);
  }, [recorder]);

  const stop = useCallback(async () => {
    clearTick();
    if (state !== 'recording') return;
    setState('uploading');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('Nothing was recorded.');

      const form = new FormData();
      // iOS records m4a, which the endpoint sniffs as audio/mp4 and accepts.
      form.append('audio', { uri, name: 'note.m4a', type: 'audio/mp4' } as never);
      form.append('use_case', useCase);

      const ctx = getModuleContext();
      const res = await ctx.apiFetch('/api/modules/ai/transcriptions', {
        method: 'POST',
        body: form,
      });
      const text = (res as { data?: { text?: string } })?.data?.text?.trim();
      if (text) onTranscript(text);
      else setError("We couldn't hear anything in that.");
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be transcribed.');
    } finally {
      setState('idle');
      setSeconds(0);
    }
  }, [clearTick, onTranscript, recorder, state, useCase]);

  const cancel = useCallback(async () => {
    clearTick();
    if (state === 'recording') await recorder.stop().catch(() => undefined);
    setState('idle');
    setSeconds(0);
  }, [clearTick, recorder, state]);

  return { state, error, seconds, start, stop, cancel, maxSeconds: MAX_SECONDS };
}
