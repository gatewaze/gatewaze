/**
 * A value slider, in pure JavaScript.
 *
 * The props match @react-native-community/slider deliberately, because module
 * code was written against that API. It is NOT that package: adding a native
 * module means a new prebuild, and this is reachable from a symptom log that
 * has to work on a bad day. PanResponder needs no native code, and is the
 * same approach the drawers and the slide-over already use.
 *
 * Values snap to `step`, so a 0 to 10 severity gives eleven stops and a
 * minutes scale in fives gives as many as it needs.
 */

import React, { useCallback, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { useTheme, radius } from '../theme/tokens';

const TRACK = 4;
const THUMB = 26;

export function Slider({
  minimumValue = 0,
  maximumValue = 10,
  step = 1,
  value,
  onValueChange,
  disabled = false,
}: {
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  value: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  // The responder is created once, so it reads the live values through a ref
  // rather than closing over the first render's props.
  const live = useRef({ width, minimumValue, maximumValue, step, onValueChange, disabled });
  live.current = { width, minimumValue, maximumValue, step, onValueChange, disabled };

  const span = Math.max(1, maximumValue - minimumValue);
  const ratio = Math.min(1, Math.max(0, (value - minimumValue) / span));

  const emit = useCallback((x: number) => {
    const s = live.current;
    if (s.disabled || s.width <= 0) return;
    const travel = Math.max(1, s.width - THUMB);
    const r = Math.min(1, Math.max(0, (x - THUMB / 2) / travel));
    const raw = s.minimumValue + r * (s.maximumValue - s.minimumValue);
    const snapped = s.step > 0
      ? Math.round(raw / s.step) * s.step
      : raw;
    const clamped = Math.min(s.maximumValue, Math.max(s.minimumValue, snapped));
    // Floating point: 0.30000000000000004 on a 0.1 step reaches the server.
    const tidy = Math.round(clamped * 1000) / 1000;
    s.onValueChange(tidy);
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      // The track is inside a ScrollView on every screen that uses it, so the
      // responder has to hold the gesture or a drag scrolls the page instead.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => emit(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => emit(evt.nativeEvent.locationX),
    })
  ).current;

  return (
    <View
      style={styles.hit}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: minimumValue, max: maximumValue, now: value }}
      {...pan.panHandlers}
    >
      <View style={[styles.track, { backgroundColor: theme.controlFill }]}>
        <View
          style={[
            styles.fill,
            { width: `${ratio * 100}%`, backgroundColor: disabled ? theme.textMuted : theme.accent },
          ]}
        />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          {
            left: ratio * Math.max(0, width - THUMB),
            backgroundColor: theme.invert,
            borderColor: theme.controlBorder,
            opacity: disabled ? 0.4 : 1,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Taller than the track so the whole row is draggable, not just 4pt of it.
  hit: { height: 44, justifyContent: 'center' },
  track: { height: TRACK, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: TRACK, borderRadius: radius.full },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 1,
  },
});
