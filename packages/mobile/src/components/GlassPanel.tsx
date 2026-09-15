/**
 * The glass surface, native-first (spec-mobile-coach-rebrand.md).
 *
 * The design's translucent panels are the designer's approximation of
 * Apple's material, so this renders the real thing where it exists:
 *   iOS 26+   Liquid Glass (expo-glass-effect) — adapts to appearance,
 *             honours Reduce Transparency, composited by the system
 *   older iOS / Android   expo-blur, or a solid translucent fill when the
 *             platform cannot blur cheaply
 *
 * Modules never choose: they use GlassPanel and get the best available
 * surface for the device.
 */

import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme, radius as radiusTokens } from '../theme/tokens';
import { withAlpha } from './primitives';

export interface GlassPanelProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** 'regular' is the default chrome material; 'clear' is lighter. */
  variant?: 'regular' | 'clear';
  /** Draw the hairline edge the design puts on every glass surface. */
  bordered?: boolean;
  /**
   * How much of the background colour to lay over the material, 0 to 1.
   *
   * The two materials are a coarse choice: 'regular' is chrome and nearly
   * opaque, 'clear' lets almost everything through, and the composer wants to
   * sit between them — content visible enough that the thread does not appear
   * to end at the panel, faint enough that it never competes with the words
   * being typed over it.
   *
   * This is the knob for that. It is deliberately NOT the scrim behind the
   * panel: that gradient has 26 points to work in and cannot be made strong
   * without showing an edge, which was learned twice.
   */
  tint?: number;
}

export function GlassPanel({
  children,
  style,
  radius = radiusTokens.lg,
  variant = 'regular',
  bordered = true,
  tint = 0,
}: GlassPanelProps) {
  const theme = useTheme();
  const shape: ViewStyle = {
    borderRadius: radius,
    overflow: 'hidden',
    ...(bordered ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border } : {}),
  };

  // Laid over the material, under the content. Absolute so it cannot affect
  // the panel's layout, and pointerEvents none so it never eats a touch.
  const wash =
    tint > 0 ? (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(theme.background, tint) }]}
      />
    ) : null;

  if (Platform.OS === 'ios' && isLiquidGlassAvailable()) {
    return (
      <GlassView style={[shape, style]} glassEffectStyle={variant}>
        {wash}
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios') {
    // Pre-26: expo-blur is the closest available material. It has no specular
    // edge and does not respond to how the device is held — that behaviour
    // belongs to Liquid Glass and is drawn by the system, not by us.
    return (
      <BlurView intensity={variant === 'clear' ? 20 : 40} tint="systemMaterial" style={[shape, style]}>
        {wash}
        {children}
      </BlurView>
    );
  }

  // Android: blur is expensive and inconsistent, so use the token fill.
  return <View style={[shape, { backgroundColor: theme.surface }, style]}>{children}</View>;
}
