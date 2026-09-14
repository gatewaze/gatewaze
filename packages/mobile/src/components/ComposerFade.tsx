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
      colors={[
        withAlpha(theme.background, layout.composerFadeStops[0]),
        withAlpha(theme.background, layout.composerFadeStops[1]),
        withAlpha(theme.background, layout.composerFadeStops[2]),
      ]}
      locations={[
        layout.composerFadeLocations[0],
        layout.composerFadeLocations[1],
        layout.composerFadeLocations[2],
      ]}
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
