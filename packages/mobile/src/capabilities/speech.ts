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
 * Transcribe a finished recording, on the device.
 *
 * ── WHY A FILE AND NOT THE LIVE MICROPHONE ────────────────────────────────
 *
 * The first version listened live, alongside the recorder — and crashed the
 * app on a real iPhone the moment the mic was pressed. Two systems capturing
 * one microphone: expo-audio's recorder holds the audio session for the
 * waveform, and the recogniser then starts its own AVAudioEngine on the same
 * input, which raises a NATIVE exception that no JavaScript catch can reach.
 * The simulator never crashed because it reports no on-device support, so the
 * live path never executed there. A capability that only runs on hardware has
 * to be assumed broken until a device has run it.
 *
 * Recognising the finished FILE removes the conflict outright: the recorder is
 * the only thing that ever touches the microphone, and recognition starts
 * after it has stopped. It also keeps the fallback exact — the same file that
 * was recognised is the one uploaded if recognition hears nothing.
 *
 * `requiresOnDeviceRecognition` stays set, so audio never reaches Apple's
 * servers: no-connection transcription is the point, and so is the audio not
 * leaving the phone.
 */
export async function transcribeFile(uri: string, locale = 'en-GB'): Promise<SpeechResult> {
  const mod = await load();
  if (!mod) return { ok: false, reason: 'not available in this build' };

  const { ExpoSpeechRecognitionModule } = mod;

  return new Promise<SpeechResult>((resolve) => {
    let best = '';
    let settled = false;
    const subs: Array<{ remove: () => void }> = [];

    const done = (result: SpeechResult) => {
      if (settled) return;
      settled = true;
      for (const s of subs) {
        try { s.remove(); } catch { /* already gone */ }
      }
      clearTimeout(timer);
      resolve(result);
    };

    // A file has a length, so recognition ends on its own — but a hang here
    // would leave the composer stuck on "uploading" forever, and the server
    // fallback is better than a stuck composer.
    const timer = setTimeout(() => {
      try { ExpoSpeechRecognitionModule.abort(); } catch { /* not running */ }
      done(best ? { ok: true, text: best } : { ok: false, reason: 'timed out' });
    }, 20_000);

    try {
      subs.push(ExpoSpeechRecognitionModule.addListener('result', (event) => {
        const transcript = event?.results?.[0]?.transcript;
        if (typeof transcript === 'string' && transcript.trim()) best = transcript.trim();
      }));
      subs.push(ExpoSpeechRecognitionModule.addListener('error', (event) => {
        done(best
          ? { ok: true, text: best }
          : { ok: false, reason: event?.message || event?.error || 'recognition failed' });
      }));
      subs.push(ExpoSpeechRecognitionModule.addListener('end', () => {
        done(best ? { ok: true, text: best } : { ok: false, reason: 'nothing heard' });
      }));

      ExpoSpeechRecognitionModule.start({
        lang: locale,
        interimResults: true,
        // Never Apple's servers. See the note above.
        requiresOnDeviceRecognition: true,
        audioSource: { uri },
      });
    } catch (err) {
      done({ ok: false, reason: err instanceof Error ? err.message : 'could not start recognition' });
    }
  });
}
