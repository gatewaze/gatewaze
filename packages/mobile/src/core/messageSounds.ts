/**
 * The two message tones: one for sending, one for the reply arriving.
 *
 * ── WHY THEY ARE SYNTHESISED, NOT SAMPLED ─────────────────────────────────
 *
 * The obvious move is to reach for the sounds everyone already knows. Those
 * belong to Apple and shipping them in a third-party app is not ours to do,
 * so these are two short original tones generated as plain waveforms.
 *
 * The SHAPE is what carries the meaning, and it is the shape that is shared
 * with every messaging app rather than the specific notes: the outgoing pair
 * RISES, which reads as something leaving, and the incoming pair FALLS and is
 * quieter, which reads as something arriving and settling. Both are struck
 * notes — instant attack, quick decay — because a sustained tone in a chat
 * sounds like an alarm.
 *
 * ── WHY THEY RESPECT THE SILENT SWITCH ────────────────────────────────────
 *
 * `playsInSilentMode: false`, deliberately. A phone on silent in a meeting
 * must not chirp because a reply arrived, and a message tone is exactly the
 * category of sound that switch exists to stop. It is also what Messages
 * itself does.
 *
 * ── EVERYTHING HERE IS FIRE AND FORGET ────────────────────────────────────
 *
 * Nothing is awaited and no failure is surfaced. A tone is a courtesy; a send
 * must never fail, stall, or log noise because audio was unavailable. The
 * module is required lazily for the same reason the haptics one is: a static
 * import of a native module runs at load, where a binary without the native
 * half throws before any of our code can catch it.
 */

import { Platform } from 'react-native';

type AudioModule = typeof import('expo-audio');
type Player = { play: () => void; seekTo: (s: number) => void; volume: number };

let cached: AudioModule | null | undefined;
let sent: Player | null = null;
let received: Player | null = null;
let configured = false;

function audio(): AudioModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-audio') as AudioModule;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Players are created once and replayed, not created per message.
 *
 * Building one costs a file read and a decode; doing that on every send would
 * put that work between the member pressing the button and anything
 * happening, which is the one moment that has to feel immediate.
 */
function player(which: 'sent' | 'received'): Player | null {
  if (Platform.OS === 'android') return null;
  const a = audio();
  if (!a) return null;

  if (!configured) {
    configured = true;
    // Never over the silent switch, and never taking over whatever the member
    // is listening to — a chat tone should duck alongside music, not stop it.
    void a.setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    }).catch(() => undefined);
  }

  try {
    if (which === 'sent') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sent = sent ?? (a.createAudioPlayer(require('../../assets/sounds/message-sent.wav')) as Player);
      return sent;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    received = received ?? (a.createAudioPlayer(require('../../assets/sounds/message-received.wav')) as Player);
    return received;
  } catch {
    return null;
  }
}

function play(which: 'sent' | 'received') {
  try {
    const p = player(which);
    if (!p) return;
    // Rewind first: a player that has already finished sits at the end, and
    // playing it again from there is silence. This is why the two rapid
    // sends of a stacked message still both sound.
    p.seekTo(0);
    p.play();
  } catch {
    /* Audio is a courtesy; never let it reach the caller. */
  }
}

/** The member sent something. */
export function playSent() {
  play('sent');
}

/** A reply arrived. */
export function playReceived() {
  play('received');
}
