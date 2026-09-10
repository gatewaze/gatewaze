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

export interface GlassPanelProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** 'regular' is the default chrome material; 'clear' is lighter. */
  variant?: 'regular' | 'clear';
  /** Draw the hairline edge the design puts on every glass surface. */
  bordered?: boolean;
}

export function GlassPanel({
  children,
  style,
  radius = radiusTokens.lg,
  variant = 'regular',
  bordered = true,
}: GlassPanelProps) {
  const theme = useTheme();
  const shape: ViewStyle = {
    borderRadius: radius,
    overflow: 'hidden',
    ...(bordered ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border } : {}),
  };

  if (Platform.OS === 'ios' && isLiquidGlassAvailable()) {
    return (
      <GlassView style={[shape, style]} glassEffectStyle={variant}>
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={variant === 'clear' ? 20 : 40} tint="systemMaterial" style={[shape, style]}>
        {children}
      </BlurView>
    );
  }

  // Android: blur is expensive and inconsistent, so use the token fill.
  return <View style={[shape, { backgroundColor: theme.surface }, style]}>{children}</View>;
}
