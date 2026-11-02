/**
 * The two round controls the composer is built from.
 *
 * They lived in CoachHome, which meant VoiceButton had to import from the
 * screen it is rendered inside and CoachBar imported them from a sibling
 * screen it otherwise has nothing to do with. Both are small, neither knows
 * anything about a thread, so they belong here with the other primitives.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Icon } from './Icon';
import { useTheme, radius, motion, layout, easing as easingToken } from '../theme/tokens';
import { usePressScale } from './usePressScale';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function CircleButton({
  icon,
  onPress,
  onPressIn,
  onPressOut,
  active = false,
  disabled = false,
  prominent = false,
  busy = false,
}: {
  icon: string;
  onPress: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Replaces the glyph with a spinner. The button stays put and stays sized. */
  busy?: boolean;
  /**
   * Draws the button filled rather than as a faint control. Used for voice
   * input, which we want people to reach for rather than overlook.
   */
  prominent?: boolean;
}) {
  const theme = useTheme();
  const filled = active || prominent;
  // Grows while held, like every other control on the platform. The caller's
  // own onPressIn/onPressOut still run: this adds to them rather than
  // replacing them, because VoiceButton records on press-in.
  const press = usePressScale(1.08);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => { press.onPressIn(); onPressIn?.(); }}
      onPressOut={() => { press.onPressOut(); onPressOut?.(); }}
      disabled={disabled}
      style={[
        styles.circle,
        press.style,
        {
          backgroundColor: filled ? theme.invert : theme.controlFill,
          borderColor: filled ? theme.invert : theme.controlBorder,
          // A prominent control keeps its weight: dimming it to 35% would
          // defeat the point of making it stand out.
          opacity: disabled && !prominent ? 0.35 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={filled ? theme.onInvert : theme.text} />
      ) : (
        <Icon name={icon} size={19} color={filled ? theme.onInvert : theme.text} />
      )}
    </AnimatedPressable>
  );
}


/** One entry in the mode track. */
export interface PillSpec {
  key: string;
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}

/**
 * The mode track, as ONE touch responder rather than a row of buttons.
 *
 * ── WHY THE PILLS ARE DATA AND NOT CHILDREN ───────────────────────────────
 *
 * The operator asked that sliding a finger across the track be "seamlessly
 * smooth and dynamic" — the pill under the finger swells, and swelling passes
 * from one to the next as the finger moves.
 *
 * A row of `Pressable`s cannot do that. Each one only knows about touches that
 * BEGIN inside it: a finger that starts on Chat and slides onto Photo never
 * reaches Photo's Pressable, because the first one holds the responder until
 * release. That is the correct behaviour for buttons and the wrong behaviour
 * for a segmented control.
 *
 * So the track claims the gesture once and works out for itself which pill the
 * finger is over, from layouts measured on render. The pills become data,
 * which is also why this takes an array rather than children: measuring
 * children would mean cloneElement and an index that silently drifts whenever
 * one of them is conditional.
 *
 * A tap still selects, because release fires the pill's own onPress — the
 * responder replaces the buttons rather than sitting on top of them.
 */
export function PillTrack({ pills, style }: { pills: PillSpec[]; style?: ViewStyle | ViewStyle[] }) {
  /** Which pill the finger is over; -1 for none. Written from the gesture. */
  const held = useSharedValue(-1);
  /**
   * The same thing again, in React state.
   *
   * The swell is a transform and lives on the native thread. The SELECTED LOOK
   * — the white fill, the expanded label, the dark glyph — is rendered, not
   * animated, so it cannot be driven from a shared value. A drag has to change
   * both, so the gesture writes both.
   *
   * Only set when it actually changes, so a drag across one pill is one
   * re-render rather than one per touch event.
   */
  const [hovered, setHovered] = useState(-1);
  const hoverRef = useRef(-1);
  const setHover = useCallback((i: number) => {
    if (hoverRef.current === i) return;
    hoverRef.current = i;
    setHovered(i);
  }, []);
  /** x and width of each pill within the track, filled in by onLayout. */
  const rects = useRef<Array<{ x: number; w: number }>>([]);
  /**
   * The track's own left edge in window coordinates.
   *
   * Needed because a touch reports `locationX` RELATIVE TO THE VIEW THAT
   * RECEIVED IT, which is whichever pill is under the finger and not the
   * track. Every touch therefore arrived with a small x measured from the
   * pill's own left edge, which resolved to index 0 every time: Chat swelled
   * and nothing else could be selected at all.
   *
   * `pageX` is absolute, so it is the only coordinate that means the same
   * thing wherever the touch landed. This is what it is measured against.
   */
  const trackX = useRef(0);
  const trackRef = useRef<View>(null);
  /** Kept in a ref so the responder never closes over a stale render's props. */
  const specs = useRef(pills);
  specs.current = pills;

  /**
   * Which pill is under this touch.
   *
   * @param pageX absolute window x of the touch.
   *
   * Falls back to the NEAREST pill rather than answering "none" when the touch
   * lands in the gap between two. The track is a strip of controls with a few
   * points of padding between them, and a finger that lands in a gap plainly
   * meant one of the two either side of it — answering nothing there makes the
   * control feel like it is ignoring you.
   */
  const indexAt = useCallback((pageX: number) => {
    const x = pageX - trackX.current;
    const inside = rects.current.findIndex((r) => r && x >= r.x && x <= r.x + r.w);
    if (inside >= 0) return inside;

    let best = -1;
    let bestGap = Infinity;
    rects.current.forEach((r, i) => {
      if (!r) return;
      const gap = x < r.x ? r.x - x : x - (r.x + r.w);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    // Only if it is genuinely near the strip. A touch that misses by a long
    // way is a miss, and selecting the end pill for it would be worse.
    return bestGap <= 24 ? best : -1;
  }, []);

  /** Re-read the track's position. Cheap, and immune to anything having moved. */
  const remeasure = useCallback(() => {
    trackRef.current?.measureInWindow((x) => {
      trackX.current = x;
    });
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim from the first touch, and keep claiming as it moves, so the
        // swell follows the finger between pills instead of stopping at the
        // edge of the one it started on.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          // Measured again on every touch rather than trusting layout time:
          // if onLayout never fired, trackX would be 0 and every hit test
          // would miss, which is a whole control silently doing nothing.
          remeasure();
          const i = indexAt(e.nativeEvent.pageX);
          held.value = i;
          setHover(i);
        },
        onPanResponderMove: (e) => {
          const i = indexAt(e.nativeEvent.pageX);
          held.value = i;
          // The pill under the finger LOOKS selected as the finger crosses it.
          // The mode itself does not change until release: opening the camera
          // mid-drag would tear the screen away underneath the gesture.
          setHover(i);
        },
        onPanResponderRelease: (e) => {
          const i = indexAt(e.nativeEvent.pageX);
          held.value = -1;
          setHover(-1);
          // Lifting outside every pill selects nothing, which is how a member
          // changes their mind after touching the wrong one.
          if (i >= 0) specs.current[i]?.onPress();
        },
        onPanResponderTerminate: () => {
          held.value = -1;
          setHover(-1);
        },
      }),
    [held, indexAt, remeasure, setHover]
  );

  return (
    <View
      ref={trackRef}
      // Measured in WINDOW coordinates, not layout ones: the track sits inside
      // the composer's own animated transforms, so its layout x says nothing
      // about where it actually is on screen.
      onLayout={() => {
        trackRef.current?.measureInWindow((x) => {
          trackX.current = x;
        });
      }}
      style={style}
      {...responder.panHandlers}
    >
      {pills.map((p, i) => (
        <ModePill
          key={p.key}
          icon={p.icon}
          label={p.label}
          /*
           * While a finger is down, the pill under it is the ONLY one that
           * looks selected — otherwise the genuinely active pill stays white
           * as well and two appear chosen at once, which reads as the control
           * having lost track of itself. With no finger down, the real
           * selection shows.
           */
          active={hovered >= 0 ? hovered === i : p.active}
          held={held}
          index={i}
          onLayout={(x, w) => {
            rects.current[i] = { x, w };
          }}
        />
      ))}
    </View>
  );
}

/**
 * A mode pill. Inactive pills are icon-only; the active pill fills and its
 * label expands, animated with the shared easing token (design: mode
 * switch, .3s, label max-width 0 to 64px plus opacity).
 */
export function ModePill({
  icon,
  label,
  active,
  held,
  index,
  onLayout,
}: {
  icon: string;
  label: string;
  active: boolean;
  /** Which pill the finger is over, owned by the track. */
  held: ReturnType<typeof useSharedValue<number>>;
  index: number;
  /** Reports this pill's position within the track so the track can hit-test. */
  onLayout: (x: number, w: number) => void;
}) {
  const theme = useTheme();
  const progress = useSharedValue(active ? 1 : 0);

  /**
   * Swells while the finger is over THIS pill.
   *
   * Derived from the track's shared value rather than from a press of its own,
   * which is what lets the swell pass from one pill to the next mid-gesture.
   * A spring rather than a timing, because the finger decides when this ends:
   * a spring is always travelling from wherever it is, so being interrupted
   * halfway is ordinary instead of a jump.
   */
  const swell = useDerivedValue(() =>
    withSpring(held.value === index ? 1 : 0, { damping: 18, stiffness: 320, mass: 0.6, reduceMotion: ReduceMotion.Never })
  );

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: motion.quick,
      easing: Easing.bezier(easingToken.x1, easingToken.y1, easingToken.x2, easingToken.y2),
    });
  }, [active, progress]);

  const labelStyle = useAnimatedStyle(() => ({
    maxWidth: progress.value * 90,
    opacity: progress.value,
    marginLeft: progress.value * 6,
  }));

  const pillStyle = useAnimatedStyle(() => ({
    paddingHorizontal: 10 + progress.value * 4,
    transform: [{ scale: 1 + swell.value * 0.09 }],
  }));

  return (
    <Animated.View
      // No Pressable here on purpose: the track owns the gesture so a finger
      // can slide between pills. See PillTrack above.
      onLayout={(e) => onLayout(e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
      style={[
        styles.pill,
        active ? styles.pillActive : null,
        { backgroundColor: active ? theme.invert : 'transparent' },
        pillStyle,
      ]}
    >
      <Icon name={icon} size={18} color={active ? theme.onInvert : theme.textMuted} />
      <Animated.View style={[styles.pillLabel, labelStyle]}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 13, fontWeight: '700', color: theme.onInvert }}
        >
          {label}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: layout.tapTarget,
    height: layout.tapTarget,
    borderRadius: layout.tapTarget / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    height: layout.modePillHeight,
    justifyContent: 'center',
  },
  pillActive: { flex: 1 },
  pillLabel: { overflow: 'hidden' },
});
