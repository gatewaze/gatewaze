/**
 * The living background: soft colour fields drifting behind all content.
 *
 * ── WHAT CHANGED, AND WHY ─────────────────────────────────────────────────
 *
 * It used to be three orbs in the brand's blue, green and violet. That reads
 * as one wash with a tint, because three hues that close together never give
 * the eye anywhere to travel. The reference the operator asked for is a mesh:
 * several broad fields of genuinely different colour, overlapping, with the
 * seams blurred away and a fine grain over the top.
 *
 * So this now draws SIX fields from `theme.ambientPalette`, larger than the
 * screen and mostly off it, each drifting and swelling on its own cycle. What
 * you see at any moment is where several of them overlap, which is what makes
 * it read as a mesh rather than as circles on a background.
 *
 * ── IT IS THEMEABLE, WHICH IS THE POINT ───────────────────────────────────
 *
 * Every colour comes from `theme.ambientPalette`. A brand changes the app's
 * whole mood by editing one array in the tokens, and the composition below is
 * unchanged. Colours are taken by index and wrap, so a palette of one colour
 * is a perfectly valid answer and gives the old single-hue look.
 *
 * ── STATIC BY DECISION ───────────────────────────────────────────────────
 *
 * The fields do not move. They used to drift and swell on infinite Reanimated
 * loops, and even with the animation on the native thread, six endlessly
 * compositing layers kept the GPU awake — visibly so on a MacBook running the
 * simulator, and the operator judged (rightly) that phones would pay for it
 * in battery. The look barely traded away: what makes this read as a mesh is
 * the overlap of the fields, not the millimetres of drift. The dx/dy/swell
 * numbers stay on the specs as documentation of each field's intended motion,
 * should a cheap way to move them ever appear.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../theme/tokens';

/** The design frame the composition below is specified against. */
const FRAME_W = 390;
const FRAME_H = 844;

interface FieldSpec {
  /** Index into the palette. Wraps, so a short palette simply repeats. */
  colorIndex: number;
  size: number;
  opacity: number;
  left: number;
  top: number;
  durationMs: number;
  dx: number;
  dy: number;
  swellMs: number;
  swellTo: number;
}

/**
 * Six fields, deliberately larger than the frame and hung off its edges.
 *
 * Opacities were raised ~1.5x after the first pass shipped: on an OLED panel,
 * under the header and composer scrims, the original values read as barely
 * more than black and the operator could not see the background at all in the
 * live app. These values are tuned to be plainly visible through the scrims
 * while the thread text stays comfortably dominant.
 *
 * A field whose whole circle is on screen reads as a disc however soft its
 * edge is. These are sized and placed so the eye only ever sees part of one,
 * which is why the result looks like weather rather than like shapes.
 *
 * Halved from the first tuning: at 11-26s per half-cycle the drift was
 * technically present and perceptually absent — the operator saw "incredibly
 * slow" colours. 6-13s reads as alive without becoming weather you watch.
 *
 * Every duration is a prime-ish number of seconds and no two are close
 * multiples, so the composition takes minutes to repeat and never visibly
 * beats in time with itself.
 */
const FIELDS: FieldSpec[] = [
  /**
   * Third composition pass, and the lesson of the first two is written here so
   * a fourth does not repeat them. Pass one was three near-identical hues —
   * read as one wash. Pass two raised opacities but kept every field's CENTRE
   * hung off the screen edge, so the visible area only ever received the faded
   * outer tails, which read as flat colour patches — measured at ~2x background
   * luminance where the design intended ~8x. Visibility lives in WHERE THE
   * CENTRES ARE, not in the opacity number: centres now sit on screen, spread
   * across it, with the fields still oversized so their edges bleed off and
   * nothing reads as a disc.
   */
  // Blue, upper-left third.
  { colorIndex: 0, size: 560, opacity: 0.50, left: -120, top: -60, durationMs: 6500, dx: 100, dy: 85, swellMs: 5200, swellTo: 1.15 },
  // Green, right edge at mid-height.
  { colorIndex: 1, size: 520, opacity: 0.42, left: FRAME_W - 320, top: FRAME_H * 0.30, durationMs: 8000, dx: -115, dy: -85, swellMs: 6100, swellTo: 0.88 },
  // Violet, lower-left.
  { colorIndex: 2, size: 540, opacity: 0.44, left: -140, top: FRAME_H * 0.52, durationMs: 9000, dx: 130, dy: -85, swellMs: 7300, swellTo: 1.18 },
  // Amber, upper-right. Weaker than the rest because warm colours advance.
  { colorIndex: 3, size: 460, opacity: 0.30, left: FRAME_W - 280, top: -80, durationMs: 10500, dx: -100, dy: 115, swellMs: 6700, swellTo: 1.12 },
  // Cyan, lower-centre.
  { colorIndex: 4, size: 500, opacity: 0.38, left: FRAME_W * 0.22, top: FRAME_H * 0.72, durationMs: 11500, dx: 85, dy: -100, swellMs: 8100, swellTo: 0.9 },
  // A second blue, centre-right, tying the field together.
  { colorIndex: 0, size: 480, opacity: 0.26, left: FRAME_W * 0.42, top: FRAME_H * 0.34, durationMs: 13500, dx: -70, dy: 70, swellMs: 9300, swellTo: 1.1 },
];

function Field({
  spec, color, scale, id,
}: {
  spec: FieldSpec; color: string; scale: number; id: string;
}) {
  const size = spec.size * scale;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: spec.left * scale,
        top: spec.top * scale,
        width: size,
        height: size,
      }}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={spec.opacity} />
            {/* A middle stop, so the falloff is not a straight line. A linear
                fade to nothing has a visible edge where it reaches zero; this
                puts most of the fade in the outer third where the eye cannot
                find it. */}
            <Stop offset="55%" stopColor={color} stopOpacity={spec.opacity * 0.72} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export function AmbientBackground() {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();

  // Scale the composition to the device without distorting it.
  const scale = Math.max(width / FRAME_W, height / FRAME_H);

  const palette = theme.ambientPalette?.length ? theme.ambientPalette : [theme.accent];
  const fields = useMemo(
    () =>
      FIELDS.map((spec, i) => ({
        spec,
        color: palette[spec.colorIndex % palette.length],
        // Stable and unique per field. Two fields sharing a gradient id would
        // both resolve to whichever was defined last, which is how a palette
        // change can silently collapse two colours into one.
        id: `ambient-${i}`,
      })),
    [palette]
  );

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {fields.map(({ spec, color, id }) => (
        <Field key={id} id={id} spec={spec} color={color} scale={scale} />
      ))}

      {/* The grain overlay is gone by choice: at an opacity low enough to
          never read as dots it read as nothing at all on a real panel, and
          the operator judged the plain gradients better. grain.ts stays for
          the day banding on OLED argues it back in. */}
    </View>
  );
}
