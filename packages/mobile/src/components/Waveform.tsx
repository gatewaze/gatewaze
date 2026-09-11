/**
 * The bars that stand in for the text field while a voice note is recording.
 *
 * They follow the recorder's own metering rather than animating on a timer,
 * so the thing on screen responds to the voice rather than merely looking
 * busy. A level that never moves is then a real signal — the microphone is
 * not picking anything up — instead of being hidden by a decorative loop.
 *
 * History scrolls right to left: each tick pushes a new bar on and drops the
 * oldest, so you can see the last couple of seconds rather than one number.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/tokens';

// More bars than the old 28, because the row now stretches to whatever width
// it is given rather than drawing at a fixed ~165pt. At the composer's width
// this keeps each bar slim instead of turning it into a bar chart.
const BARS = 40;
/** Quiet rooms still show life; a flat line means nothing is arriving. */
const FLOOR = 0.08;

/**
 * Metering is in dBFS, roughly -60 (silence) to 0 (clipping). Speech sits
 * around -30 to -10, so the useful range is compressed into the top half and
 * a linear map would leave the bars nearly flat.
 */
function levelFromMetering(db: number | undefined): number {
  if (db == null || !Number.isFinite(db)) return FLOOR;
  const clamped = Math.max(-60, Math.min(0, db));
  const normalised = (clamped + 60) / 60;
  return Math.max(FLOOR, Math.min(1, normalised ** 2.2));
}

export function Waveform({ metering, active, style }: {
  metering?: number;
  active: boolean;
  /** Pass `{ flex: 1 }` to fill the space beside a label. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [bars, setBars] = useState<number[]>(() => new Array(BARS).fill(FLOOR));
  const latest = useRef(FLOOR);

  latest.current = levelFromMetering(metering);

  useEffect(() => {
    if (!active) {
      setBars(new Array(BARS).fill(FLOOR));
      return;
    }
    // Sampled on a timer rather than on every metering update: the callback
    // fires irregularly, and an even cadence is what makes it read as a
    // waveform rather than a jitter.
    const t = setInterval(() => {
      setBars((prev) => [...prev.slice(1), latest.current]);
    }, 60);
    return () => clearInterval(t);
  }, [active]);

  return (
    // No label of its own: the indicator wrapping this one names the
    // state, and it knows whether the note is being recorded or sent.
    <View style={[styles.row, style]}>
      {bars.map((level, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: Math.round(4 + level * 24),
              backgroundColor: theme.accent,
              // The newest bars are the brightest, so the eye follows the
              // direction the sound is arriving from.
              opacity: 0.35 + (i / BARS) * 0.65,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 28,
  },
  // Each bar takes an equal share of whatever width the row has, so the
  // waveform fills the field rather than sitting in a fixed-width block.
  bar: { flex: 1, borderRadius: 2 },
});
