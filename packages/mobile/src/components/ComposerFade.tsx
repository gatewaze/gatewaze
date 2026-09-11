/**
 * The ground the composer sits on. Two strips, above it and below it.
 *
 * Content scrolling toward the composer dissolves into the app's ground over
 * `COMPOSER_FADE_HEIGHT` instead of running underneath it. Below the panel
 * there is the margin that clears the home indicator, and content was showing
 * through that: it faded out above the composer and then reappeared beneath
 * it. The second strip is flat, at the colour the gradient ends on, so the
 * fade carries on past the panel instead of stopping at it.
 *
 * Neither strip covers the panel itself, and that is the point. An earlier
 * version wrapped the panel in the gradient, which put a 97% opaque backdrop
 * on the glass and stopped it reading as glass. The thread showing faintly
 * through the panel is what makes it look like glass; the strips only deal
 * with the content that would otherwise be fully legible around it.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, layout } from '../theme/tokens';
import { withAlpha } from './primitives';

/** Tall enough to dissolve a line of text, short enough not to eat the view. */
export const COMPOSER_FADE_HEIGHT = 72;

export function ComposerFade({ bottom = 0 }: {
  /**
   * Height of the flat strip under the panel. The composer passes its own
   * bottom padding, which is the only gap content can show through.
   */
  bottom?: number;
}) {
  const theme = useTheme();
  const ground = withAlpha(theme.background, layout.composerFadeStops[2]);
  return (
    <>
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
        style={styles.fade}
        pointerEvents="none"
      />
      {bottom > 0 ? (
        <View
          style={[styles.base, { height: bottom, backgroundColor: ground }]}
          pointerEvents="none"
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: COMPOSER_FADE_HEIGHT,
  },
  base: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});
