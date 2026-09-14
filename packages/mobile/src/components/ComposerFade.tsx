/**
 * The scrim the composer sits on.
 *
 * Content scrolling up the thread stops being legible before it reaches the
 * composer, so it does not read as sliding underneath a window. This is the
 * mirror of the header's fade at the top of the screen.
 *
 * ── THIS IS NOT THE KNOB FOR "I CAN SEE THROUGH THE COMPOSER" ─────────────
 *
 * It was tuned twice for that and failed both ways. The panel's top edge is
 * only `composerPadTop` below the top of this layer, and a gradient cannot
 * climb from nothing to nearly opaque in 26 points without showing an edge;
 * back it off and the thread is legible through the glass again. There is no
 * setting here that does both.
 *
 * How transparent the composer looks is a property of the PANEL. See the
 * `tint` on its GlassPanel.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, layout } from '../theme/tokens';
import { withAlpha } from './primitives';

export function ComposerFade() {
  const theme = useTheme();
  return (
    <LinearGradient
      /* Mapped, not indexed, so the token curve can gain or lose stops
         without this file changing. The cast keeps expo-linear-gradient's
         tuple type satisfied for a readonly token array. */
      colors={layout.composerFadeStops.map((s) => withAlpha(theme.background, s)) as [string, string, ...string[]]}
      locations={[...layout.composerFadeLocations] as [number, number, ...number[]]}
      style={styles.layer}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  // Spans the panel and the margin below it. The composer reserves no top
  // padding, so the top of this layer is the top of the panel.
  layer: { ...StyleSheet.absoluteFillObject },
});
