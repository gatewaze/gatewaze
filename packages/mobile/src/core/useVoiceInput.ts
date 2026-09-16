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
  useAudioRecorderState,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { getModuleContext } from './context';
import { humanMessage } from './errors';


export type VoiceState = 'idle' | 'recording' | 'uploading';

/** Matches the server's cap for this use case; it refuses longer anyway. */
const MAX_SECONDS = 120;

/**
 * How long to wait for a transcript, for a recording of `seconds`.
 *
 * The client's default deadline is thirty seconds, which was quietly deciding
 * how long a voice note could be: the server's work here is proportional to
 * the length of the audio, so a fixed deadline is a maximum duration wearing a
 * different hat. Anything over about half a minute of speech was cut off by
 * the phone while the server was still working on it, and the member was told
 * it had failed.
 *
 * The allowance is deliberately much larger than the server's own budget for
 * the same audio. If the work is going to fail it should fail on the server,
 * which knows why and can say so. A client that gives up first turns every
 * cause into the same shrug.
 */
function uploadTimeoutMs(seconds: number): number {
  const BASE_MS = 30_000;          // upload, queueing, and the round trip
  const PER_AUDIO_SECOND_MS = 3_000;
  return BASE_MS + Math.min(seconds, MAX_SECONDS) * PER_AUDIO_SECOND_MS;
}

export function useVoiceInput({
  useCase,
  onTranscript,
}: {
  useCase: string;
  onTranscript: (text: string) => void;
}) {
  // Metering is off in the preset. The waveform follows the recorder's own
  // level rather than a timer, so without this it would animate whether or
  // not the microphone was picking anything up — which is the one thing it
  // most needs to be able to show.
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  // Metering lives on RecorderState, not on the status listener's payload, so
  // it is read by polling the recorder rather than pushed. 100ms is well under
  // the waveform's own 60ms sampling and cheap.
  const recorderState = useAudioRecorderState(recorder, 100);
  const metering = recorderState.metering;
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  /**
   * The recording whose upload failed, kept so it can be sent again.
   *
   * Losing it is the part that actually hurt. A member in a basement gym
   * dictates a note, the upload fails on one bar, and under the old code the
   * file was simply forgotten — so the only way to recover was to say the whole
   * thing again, with no indication that was what had happened. The audio is
   * already on the device and costs nothing to keep.
   */
  const [pending, setPending] = useState<{ uri: string; seconds: number } | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * The same count as `seconds`, in a ref.
   *
   * `stop` is a callback that does not list `seconds` in its dependencies, so
   * reading the state there would give whatever it was when the callback was
   * last built, which is zero. The upload allowance depends on getting this
   * right, so it reads the ref.
   */
  const elapsed = useRef(0);

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
    elapsed.current = 0;
    setState('recording');
    tick.current = setInterval(() => {
      setSeconds((s) => {
        // Stop rather than let the server reject a file it already received.
        if (s + 1 >= MAX_SECONDS) void stop();
        elapsed.current = s + 1;
        return s + 1;
      });
    }, 1000);
  }, [recorder]);

  /**
   * Send one recording. Shared by the first attempt and by every retry, so the
   * two can never drift apart.
   */
  const upload = useCallback(async (uri: string, seconds: number) => {
    const form = new FormData();
    // iOS records m4a, which the endpoint sniffs as audio/mp4 and accepts.
    form.append('audio', { uri, name: 'note.m4a', type: 'audio/mp4' } as never);
    form.append('use_case', useCase);

    const ctx = getModuleContext();
    const res = await ctx.apiFetch('/api/ai/transcriptions', {
      method: 'POST',
      body: form,
      timeoutMs: uploadTimeoutMs(seconds),
    });
    const text = (res as { data?: { text?: string } })?.data?.text?.trim();
    if (text) {
      onTranscript(text);
      setPending(null);
      setError(null);
    } else {
      // Heard nothing. That is an answer, not a failure, so the recording is
      // dropped rather than offered for retry.
      setPending(null);
      setError("We couldn't hear anything in that.");
    }
  }, [onTranscript, useCase]);

  const stop = useCallback(async () => {
    clearTick();
    if (state !== 'recording') return;
    setState('uploading');
    try {
      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) throw new Error('Nothing was recorded.');
      const recorded = elapsed.current;

      /**
       * Straight to the upload. On-device recognition is NOT called here.
       *
       * It was, twice, and both attempts crashed the app on a real iPhone
       * inside expo-speech-recognition's native code — first the live
       * recogniser fighting the recorder for the microphone, then the
       * file-based path at stop. Both crashes were invisible in the
       * simulator, which reports no on-device support and so never runs a
       * line of it.
       *
       * capabilities/speech.ts is kept, unreferenced, for when a device
       * crash log can say what actually failed. Until then a mic that works
       * over the network beats a faster one that takes the app down.
       */
      await upload(uri, recorded);
    } catch (err) {
      // Same trap as the coach's send had: a raw Error message always won, so
      // a bad connection said "Network request failed" — and nothing rendered
      // it anyway, so it said nothing at all.
      const human = humanMessage(err);
      setError(human.text);
      // Held for a retry, but only where trying again could plausibly work.
      // A refused file will be refused again, and offering to resend it just
      // teaches the member that the button does nothing.
      if (human.action === 'retry' && recorder.uri) {
        setPending({ uri: recorder.uri, seconds: elapsed.current });
      }
    } finally {
      setState('idle');
      setSeconds(0);
    }
  }, [clearTick, onTranscript, recorder, state, useCase]);

  /**
   * Send the held recording again. Nothing was re-recorded and nothing was
   * lost: this is the same audio, which is the whole point of keeping it.
   */
  const retry = useCallback(async () => {
    if (!pending) return;
    setState('uploading');
    setError(null);
    try {
      await upload(pending.uri, pending.seconds);
    } catch (err) {
      setError(humanMessage(err).text);
    } finally {
      setState('idle');
    }
  }, [pending, upload]);

  const cancel = useCallback(async () => {
    clearTick();
    if (state === 'recording') await recorder.stop().catch(() => undefined);
    setState('idle');
    setSeconds(0);
    elapsed.current = 0;
  }, [clearTick, recorder, state]);

  return {
    state, error, seconds, metering, start, stop, cancel, retry,
    /** True when a failed recording is still held and can be sent again. */
    canRetry: pending !== null,
    maxSeconds: MAX_SECONDS,
  };
}
