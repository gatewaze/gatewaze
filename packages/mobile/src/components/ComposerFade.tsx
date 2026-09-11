/**
 * The strip of fade that sits directly above the composer.
 *
 * Content scrolling toward the composer dissolves into the app's ground
 * instead of running underneath it and showing through the glass. The fade
 * stops where the panel begins, and that is the whole point: an earlier
 * version wrapped the panel in the gradient, so the panel's own backdrop was
 * 97% opaque and the glass could not read as glass. The fade is for the
 * content; the panel is glass over whatever is actually behind it.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, layout } from '../theme/tokens';
import { withAlpha } from './primitives';

/** Tall enough to dissolve a line of text, short enough not to eat the view. */
export const COMPOSER_FADE_HEIGHT = 72;

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
      style={styles.fade}
      pointerEvents="none"
    />
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
});
