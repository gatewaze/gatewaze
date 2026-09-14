/**
 * Turning speech into text on the phone.
 *
 * ── WHY THIS EXISTS ALONGSIDE THE SERVER PATH ─────────────────────────────
 *
 * The recorder uploads a file and the server transcribes it, which needs a
 * connection. The place this app is used most is a gym, frequently a basement,
 * and the complaint that started this was dictation failing on one bar of LTE.
 * On-device recognition needs no connection at all, returns in about the time
 * it takes to stop talking, and the audio never leaves the phone — which for an
 * app whose notes are about somebody's health is worth having on its own.
 *
 * It is NOT a replacement. Apple's on-device model is weaker on proper nouns
 * than a server model, and exercise and medicine names are mostly proper nouns.
 * So this is tried first and the server remains the fallback, which is also
 * what happens on a device that has no on-device model for the locale.
 *
 * ── EVERYTHING HERE IS OPTIONAL AT RUNTIME ────────────────────────────────
 *
 * The native module is only in the build when a module declares the microphone
 * capability. The import is therefore lazy and every failure is answered with
 * "not available" rather than a throw: a build without it must still run.
 */

import { Platform } from 'react-native';

export interface SpeechResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

type Mod = typeof import('expo-speech-recognition');

let cached: Mod | null | undefined;

/** The module, or null where it is not in this build. Loaded once. */
async function load(): Promise<Mod | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await import('expo-speech-recognition');
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Can this device transcribe without a connection?
 *
 * False is an ordinary answer: an older device, a locale with no downloaded
 * model, or a build without the module. The caller uploads instead.
 */
export async function onDeviceAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const mod = await load();
  if (!mod) return false;
  try {
    return Boolean(mod.ExpoSpeechRecognitionModule.supportsOnDeviceRecognition());
  } catch {
    return false;
  }
}

/** Ask for the speech permission. Separate from the microphone's. */
export async function requestSpeechPermission(): Promise<boolean> {
  const mod = await load();
  if (!mod) return false;
  try {
    const res = await mod.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return Boolean(res?.granted);
  } catch {
    return false;
  }
}

/**
 * Listen until `stop()` is called, then resolve with what was heard.
 *
 * Returns a handle rather than taking a duration: the member decides when they
 * have finished speaking, exactly as they do with the recorder, and the two are
 * driven by the same button.
 *
 * `requiresOnDeviceRecognition` is set, so this never silently falls back to
 * Apple's server recognition. If it did, the audio would leave the phone
 * without anybody choosing that — which is the one property this path exists
 * to provide.
 */
export async function listen(locale = 'en-GB'): Promise<{
  stop: () => Promise<SpeechResult>;
  cancel: () => void;
} | null> {
  const mod = await load();
  if (!mod) return null;

  const { ExpoSpeechRecognitionModule } = mod;
  let best = '';
  let failed: string | null = null;
  let settled = false;

  const onResult = (event: { results?: Array<{ transcript?: string }> }) => {
    const transcript = event?.results?.[0]?.transcript;
    // Partial results arrive continuously; the last one is the fullest.
    if (typeof transcript === 'string' && transcript.trim()) best = transcript.trim();
  };
  const onError = (event: { error?: string; message?: string }) => {
    failed = event?.message || event?.error || 'recognition failed';
  };

  const resultSub = ExpoSpeechRecognitionModule.addListener('result', onResult);
  const errorSub = ExpoSpeechRecognitionModule.addListener('error', onError);

  const cleanup = () => {
    if (settled) return;
    settled = true;
    try { resultSub?.remove(); } catch { /* already gone */ }
    try { errorSub?.remove(); } catch { /* already gone */ }
  };

  try {
    ExpoSpeechRecognitionModule.start({
      lang: locale,
      interimResults: true,
      // Never Apple's servers. See the note above.
      requiresOnDeviceRecognition: true,
      continuous: true,
    });
  } catch {
    cleanup();
    return null;
  }

  return {
    async stop() {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // Stopping a session that already ended is not an error.
      }
      // The final result lands after stop(), so give it a moment before
      // deciding there was nothing. Short enough that a member does not feel
      // it, long enough that a finished sentence arrives.
      await new Promise((resolve) => setTimeout(resolve, 450));
      cleanup();
      if (failed) return { ok: false, reason: failed };
      if (!best) return { ok: false, reason: 'nothing heard' };
      return { ok: true, text: best };
    },
    cancel() {
      try { ExpoSpeechRecognitionModule.abort(); } catch { /* nothing running */ }
      cleanup();
    },
  };
}
