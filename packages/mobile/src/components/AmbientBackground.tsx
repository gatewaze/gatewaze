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
 * ── AND IT COSTS ALMOST NOTHING ───────────────────────────────────────────
 *
 * The operator asked whether the portal's approach would be too heavy here.
 * The portal does this with CSS on the DOM, which has no equivalent in React
 * Native, but the underlying idea ports fine and this is the cheap way to do
 * it: each field is ONE svg radial gradient, drawn once, and animated by a
 * transform on the native thread through Reanimated. Nothing re-renders per
 * frame, no JavaScript runs during the animation, and the GPU is compositing
 * six textures. That is well inside what a phone does without noticing.
 *
 * The expensive way, and the one to avoid, is redrawing the gradients each
 * frame or animating their colour stops, which forces the SVG to rasterise
 * again and again. Nothing here does that: the colours are fixed and only the
 * transforms move.
 *
 * Honours Reduce Motion: the fields render in place and never animate.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../theme/tokens';
import { GRAIN_URI } from './grain';

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
 * A field whose whole circle is on screen reads as a disc however soft its
 * edge is. These are sized and placed so the eye only ever sees part of one,
 * which is why the result looks like weather rather than like shapes.
 *
 * Every duration is a prime-ish number of seconds and no two are close
 * multiples, so the composition takes minutes to repeat and never visibly
 * beats in time with itself.
 */
const FIELDS: FieldSpec[] = [
  { colorIndex: 0, size: 620, opacity: 0.38, left: -210, top: -240, durationMs: 11000, dx: 110, dy: 90, swellMs: 8300, swellTo: 1.18 },
  { colorIndex: 1, size: 560, opacity: 0.30, left: FRAME_W - 300, top: FRAME_H - 380, durationMs: 14000, dx: -120, dy: -95, swellMs: 9700, swellTo: 0.84 },
  { colorIndex: 2, size: 520, opacity: 0.32, left: -230, top: FRAME_H * 0.36, durationMs: 16000, dx: 140, dy: -80, swellMs: 12100, swellTo: 1.22 },
  // Amber, top-right. The warm one is what stops the whole field reading as
  // cold, and it is kept weaker than the rest because warm colours advance:
  // at equal opacity it would sit in front of everything else.
  { colorIndex: 3, size: 470, opacity: 0.22, left: FRAME_W - 210, top: -150, durationMs: 19000, dx: -95, dy: 120, swellMs: 10300, swellTo: 1.15 },
  { colorIndex: 4, size: 500, opacity: 0.26, left: FRAME_W * 0.18, top: FRAME_H * 0.62, durationMs: 21000, dx: 90, dy: -110, swellMs: 13700, swellTo: 0.88 },
  // A second pass of the first hue, low and slow, to tie the top and bottom
  // of the screen together.
  { colorIndex: 0, size: 580, opacity: 0.18, left: FRAME_W * 0.30, top: FRAME_H - 200, durationMs: 26000, dx: -70, dy: -60, swellMs: 15500, swellTo: 1.12 },
];

function Field({
  spec, color, scale, animate, id,
}: {
  spec: FieldSpec; color: string; scale: number; animate: boolean; id: string;
}) {
  const drift = useSharedValue(0);
  const swell = useSharedValue(0);

  useEffect(() => {
    if (!animate) return;
    drift.value = withRepeat(
      withTiming(1, { duration: spec.durationMs, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    swell.value = withRepeat(
      withTiming(1, { duration: spec.swellMs, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [animate, drift, swell, spec.durationMs, spec.swellMs]);

  // Transform only. The gradient itself never changes, so the SVG is
  // rasterised once and the rest is the GPU moving a texture about.
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: drift.value * spec.dx * scale },
      { translateY: drift.value * spec.dy * scale },
      { scale: 1 + swell.value * (spec.swellTo - 1) },
    ],
  }));

  const size = spec.size * scale;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: spec.left * scale,
          top: spec.top * scale,
          width: size,
          height: size,
        },
        style,
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={spec.opacity} />
            {/* A middle stop, so the falloff is not a straight line. A linear
                fade to nothing has a visible edge where it reaches zero; this
                puts most of the fade in the outer third where the eye cannot
                find it. */}
            <Stop offset="45%" stopColor={color} stopOpacity={spec.opacity * 0.55} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export function AmbientBackground() {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (alive) setAnimate(!reduced);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) =>
      setAnimate(!reduced)
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

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
        <Field key={id} id={id} spec={spec} color={color} scale={scale} animate={animate} />
      ))}

      {/*
        The grain, over everything.

        Two jobs. It is most of what makes the reference look considered rather
        than flat, and it hides the banding that a wide soft gradient shows on
        an OLED panel, where one hue meets the next across only a few levels of
        colour. Tiled at its natural size and very faint: at this opacity it is
        texture rather than noise, and it must never be visible as dots.
      */}
      {/* The whole layer is already pointerEvents="none"; Image has no such
          prop of its own. */}
      <Image
        source={{ uri: GRAIN_URI }}
        resizeMode="repeat"
        style={[StyleSheet.absoluteFill, { opacity: 0.06, width: undefined, height: undefined }]}
      />
    </View>
  );
}
