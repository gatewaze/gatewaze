/**
 * Camera capability — PRIMITIVES tier (spec-mobile-app.md capability kit).
 *
 * Composition, not override: modules render their own chrome and overlays
 * as children of CameraSurface (e.g. a translucent pose-framing guide over
 * the camera showing how to stand). Core screens are never patched by
 * modules.
 *
 * Requires the module to declare requiredCapabilities: ['camera'].
 */

import React, { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CameraView,
  useCameraPermissions,
  type CameraViewProps,
  type BarcodeScanningResult,
} from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme/tokens';

export { useCameraPermissions };
export type { BarcodeScanningResult };

/**
 * The camera surface. Children render above the preview (absolute-fill
 * them for overlays). Handles the permission ask inline with a clear
 * grant-state UI, so every capture screen behaves the same.
 */
export const CameraSurface = forwardRef<CameraView, CameraViewProps & { children?: React.ReactNode }>(
  function CameraSurface({ children, style, ...props }, ref) {
    const [permission, requestPermission] = useCameraPermissions();

    if (!permission) return <View style={[styles.surface, style]} />;
    if (!permission.granted) {
      return (
        <View style={[styles.surface, styles.permission, style]}>
          <MaterialCommunityIcons name="camera-off" size={36} color="#fff" />
          <Text style={styles.permissionText}>
            Camera access is needed for this feature.
          </Text>
          <Pressable style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Allow camera</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={[styles.surface, style]}>
        <CameraView ref={ref} style={StyleSheet.absoluteFill} {...props} />
        {children}
      </View>
    );
  }
);

/**
 * The white corner-bracket framing overlay from the reference designs —
 * generic: barcode scan framing, meal-photo framing, or any "aim here"
 * guidance. Modules layer their own guidance (silhouettes, hints) with it.
 */
export function ScanFrame({
  size = 180,
  color = '#FFFFFF',
  thickness = 4,
  cornerLength = 28,
}: {
  size?: number;
  color?: string;
  thickness?: number;
  cornerLength?: number;
}) {
  const corner = (rotate: string, position: object) => (
    <View
      style={[
        styles.corner,
        position,
        {
          borderColor: color,
          borderTopWidth: thickness,
          borderLeftWidth: thickness,
          width: cornerLength,
          height: cornerLength,
          transform: [{ rotate }],
        },
      ]}
    />
  );
  return (
    <View pointerEvents="none" style={styles.frameWrap}>
      <View style={{ width: size, height: size }}>
        {corner('0deg', { top: 0, left: 0 })}
        {corner('90deg', { top: 0, right: 0 })}
        {corner('270deg', { bottom: 0, left: 0 })}
        {corner('180deg', { bottom: 0, right: 0 })}
      </View>
    </View>
  );
}

/** The round capture button from the reference designs. */
export function CaptureButton({ onPress, color = colors.accent }: { onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.capture, { borderColor: color, opacity: pressed ? 0.8 : 1 }]}>
      <View style={[styles.captureInner, { backgroundColor: color }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  permission: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  permissionText: { color: '#fff', textAlign: 'center', fontSize: 15 },
  permissionButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  permissionButtonText: { color: '#fff', fontWeight: '600' },
  frameWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: { position: 'absolute' },
  capture: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  captureInner: { width: 52, height: 52, borderRadius: 26 },
});
