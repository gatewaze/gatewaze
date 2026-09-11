/**
 * The ground the composer sits on.
 *
 * One gradient filling the composer's area, drawn UNDERNEATH the panel. It is
 * fully transparent at the panel's top edge and nearly opaque by the bottom of
 * the screen, so content carries on behind the glass and dissolves on the way
 * down instead of ending on a line.
 *
 * Three things this is deliberately not, each of which was tried:
 *
 *   Above the panel. Dissolving content over a strip before it reached the
 *   composer hid rows the member was still reading.
 *
 *   A flat fill. It hid content behind the panel completely, which is a hard
 *   cutoff at the panel's top edge and wastes the glass.
 *
 *   Nothing at all below the panel. Content stayed fully legible in the margin
 *   under the composer, so it faded out and then came back.
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
