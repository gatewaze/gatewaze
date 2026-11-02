/**
 * Barcode capability — PREFAB tier: a ready-made scanner screen built from
 * the camera primitives, for modules that need no custom chrome. Modules
 * wanting a different look compose CameraSurface + ScanFrame themselves.
 *
 * Restricted to retail food symbologies (EAN-8/13, UPC-A/E), matching the
 * platform's web scanner. Requires requiredCapabilities: ['barcode'].
 */

import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraSurface, ScanFrame, type BarcodeScanningResult } from './camera';
import { colors, radius, spacing } from '../theme/tokens';

const SYMBOLOGIES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

export function BarcodeScannerView({
  onScanned,
  hint = 'Line the barcode up inside the frame',
  children,
}: {
  /** Called once per distinct code; debounced against repeat frames. */
  onScanned: (code: string) => void;
  /**
   * The line shown under the frame. Pass null to suppress it when the
   * caller supplies its own guidance through `children`, otherwise both
   * are drawn and the instruction appears twice.
   */
  hint?: string | null;
  /** Extra overlay content composed by the caller. */
  children?: React.ReactNode;
}) {
  const [torch, setTorch] = useState(false);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const handle = (result: BarcodeScanningResult) => {
    const code = result.data;
    const now = Date.now();
    if (code === lastRef.current.code && now - lastRef.current.at < 2500) return;
    lastRef.current = { code, at: now };
    onScanned(code);
  };

  return (
    <CameraSurface
      facing="back"
      enableTorch={torch}
      barcodeScannerSettings={{ barcodeTypes: [...SYMBOLOGIES] }}
      onBarcodeScanned={handle}
    >
      {/* The glyph is what distinguishes this from the meal scanner,
          which uses the same frame with nothing inside it. */}
      <ScanFrame size={200} glyph="barcode" />
      <View style={styles.topRight}>
        <Pressable onPress={() => setTorch((t) => !t)} style={styles.torch}>
          <MaterialCommunityIcons
            name={torch ? 'flash' : 'flash-off'}
            size={22}
            color="#fff"
          />
        </Pressable>
      </View>
      {hint ? (
        <View style={styles.hintWrap}>
          <Text style={styles.hint}>{hint}</Text>
        </View>
      ) : null}
      {children}
    </CameraSurface>
  );
}

const styles = StyleSheet.create({
  topRight: { position: 'absolute', top: spacing.md, right: spacing.md },
  torch: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.full,
    padding: spacing.sm,
  },
  hintWrap: {
    position: 'absolute',
    bottom: spacing.lg,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    fontSize: 13,
  },
});

export { colors };
