/**
 * A view that grows to exactly the height of the keyboard.
 *
 * Put it at the end of a scrollable form and the content above it can always
 * be scrolled clear of the keyboard, however the surface is positioned.
 *
 * ── WHY MODULES NEED THIS FROM THE KIT ────────────────────────────────────
 *
 * Module code may not import react-native-reanimated: the dependency
 * allowlist keeps native packages on the core's side so a module cannot pull
 * in a second copy or drift to a different version. Reading the keyboard
 * height needs reanimated, so the core owns the reading and hands modules the
 * result as a component.
 *
 * ── WHY NOT KeyboardAvoidingView ──────────────────────────────────────────
 *
 * KeyboardAvoidingView positions itself by measuring its own frame on screen.
 * Any surface inside the drawer's animated translate and scale measures wrong,
 * which is how the composer ended up under the keyboard once already. Reading
 * the height from the platform is immune to every ancestor transform.
 */

import React from 'react';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

export function KeyboardSpacer({ extra = 0 }: { extra?: number }) {
  const keyboard = useAnimatedKeyboard();
  /**
   * A spacer rather than animated padding, because contentContainerStyle is
   * not an animatable prop on a ScrollView.
   */
  const style = useAnimatedStyle(() => ({
    height: keyboard.height.value > 0 ? keyboard.height.value + extra : 0,
  }));
  return <Animated.View pointerEvents="none" style={style} />;
}
