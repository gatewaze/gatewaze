/**
 * The frame a composer-mode surface draws inside.
 *
 * A mode fills the whole content area, which the header and composer float
 * over. This keeps a surface's content inside the clear band between them,
 * so a result list or a row of controls can never end up hidden behind
 * either. Modules use this instead of reserving space themselves: the
 * numbers come from the core, which is the only thing that knows them.
 *
 * `bleed` is for a surface with a full-screen backdrop, e.g. a camera
 * preview. The backdrop fills edge to edge as it should, while the controls
 * layered on top stay inside the clear band.
 */

import React from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useChromeInsets } from '../core/chrome';
import { spacing } from '../theme/tokens';

export interface ModeSurfaceProps {
  children?: React.ReactNode;
  /**
   * Drawn edge to edge behind the content, ignoring the chrome. For a camera
   * preview or any other full-screen backdrop.
   */
  bleed?: React.ReactNode;
  /** Scroll the content when it is taller than the clear band. */
  scroll?: boolean;
  /** Adds the standard gutter inside the clear band. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ModeSurface({
  children,
  bleed,
  scroll = false,
  padded = true,
  style,
}: ModeSurfaceProps) {
  const chrome = useChromeInsets();

  // A little breathing room so content does not sit hard against the chrome.
  const inset = {
    paddingTop: chrome.top + (padded ? spacing.md : 0),
    paddingBottom: chrome.bottom + (padded ? spacing.md : 0),
    paddingHorizontal: padded ? spacing.md : 0,
  };

  const content = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[inset, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, inset, style]}>{children}</View>
  );

  if (!bleed) return content;

  return (
    <View style={styles.fill}>
      <View style={styles.bleed} pointerEvents="box-none">
        {bleed}
      </View>
      {content}
    </View>
  );
}

const styles = {
  fill: { flex: 1 } as ViewStyle,
  bleed: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as ViewStyle,
};
