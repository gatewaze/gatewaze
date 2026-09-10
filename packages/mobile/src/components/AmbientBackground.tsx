/**
 * The "living gradient": three blurred radial orbs drifting behind all
 * content and bleeding off-screen, per the design system.
 *
 * They are radial GRADIENTS that fade to transparent at 70%, not solid
 * circles — a solid fill reads as a hard-edged disc and dominates the
 * screen, which is the opposite of ambient. React Native has no radial
 * gradient, so these are drawn with react-native-svg.
 *
 * Geometry is specified against the design's 390x844 frame and scaled to
 * the device so the composition holds on larger screens. Honours Reduce
 * Motion: the orbs render in place and never animate.
 */

import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../theme/tokens';

const FRAME_W = 390;
const FRAME_H = 844;

interface OrbSpec {
  size: number;
  color: string;
  opacity: number;
  /** Top-left of the orb box in design coordinates. */
  left: number;
  top: number;
  durationMs: number;
  /** Mid-point translation of the drift, in design pixels. */
  dx: number;
  dy: number;
  /**
   * How long a swell takes. Deliberately not a neat fraction of the drift
   * so the two never line up and the motion keeps looking organic.
   */
  swellMs: number;
  /** Scale at the far end of the swell. */
  swellTo: number;
}

function Orb({ spec, scale, animate }: { spec: OrbSpec; scale: number; animate: boolean }) {
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

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: drift.value * spec.dx * scale },
      { translateY: drift.value * spec.dy * scale },
      // Swelling and shrinking as it drifts, so the field moves like a
      // lamp rather than sliding rigidly.
      { scale: 1 + swell.value * (spec.swellTo - 1) },
    ],
  }));

  const size = spec.size * scale;
  const id = `orb-${spec.color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: spec.left * scale, top: spec.top * scale, width: size, height: size },
        style,
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={spec.color} stopOpacity={spec.opacity} />
            <Stop offset="70%" stopColor={spec.color} stopOpacity={0} />
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

  // Scale the design's composition to the device without distorting it.
  const scale = Math.max(width / FRAME_W, height / FRAME_H);

  // Faster than the design's 18/23/27s by request, each with a swell on a
  // separate cycle so the three never beat in time with one another.
  const orbs: OrbSpec[] = [
    // Blue, top-left, drifting down-right.
    { size: 530, color: theme.accent, opacity: 0.34, left: -155, top: -175, durationMs: 11000, dx: 90, dy: 80, swellMs: 8300, swellTo: 1.18 },
    // Teal, bottom-right, drifting up-left.
    {
      size: 490,
      color: theme.coach,
      opacity: 0.24,
      left: FRAME_W - 490 + 175,
      top: FRAME_H - 490 + 145,
      durationMs: 14000,
      dx: -110,
      dy: -90,
      swellMs: 9700,
      swellTo: 0.84,
    },
    // Purple, left at 34% height, drifting up-right.
    { size: 450, color: theme.ambient, opacity: 0.28, left: -190, top: FRAME_H * 0.34, durationMs: 16000, dx: 130, dy: -70, swellMs: 12100, swellTo: 1.22 },
  ];

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {orbs.map((spec, i) => (
        <Orb key={i} spec={spec} scale={scale} animate={animate} />
      ))}
    </View>
  );
}
