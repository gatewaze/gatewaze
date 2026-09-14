/**
 * The HELF wordmark.
 *
 * From helf-ios-brand-assets/SVG/helf-logo-light.svg: H, L and F are flat
 * geometric letters that take one colour; the E is three bars in the brand's
 * fixed cyan/blue/violet, which stay those colours on any ground. The letters
 * default to white — the mark sits on the mesh and the drawer's dark ground,
 * both of which want the light variant.
 *
 * Inlined as rects rather than imported from the .svg, because
 * react-native-svg-transformer is not installed and adding a Metro
 * transformer to render one logo is a poor trade. If the artwork changes,
 * regenerate from the asset pack rather than editing geometry by hand.
 */

import React from 'react';
import Svg, { G, Rect } from 'react-native-svg';

/** Intrinsic 840 x 240 canvas; the drawn art spans x 40..794, y 40..200. */
export const LOGO_ASPECT = 840 / 240;

const E_TOP = '#86EDEB';
const E_MIDDLE = '#7FB5F7';
const E_BOTTOM = '#8676F4';

export function HelfLogo({
  height = 20,
  color = '#ffffff',
}: {
  height?: number;
  /** Colour of the H, L and F. The E's bars keep their brand colours. */
  color?: string;
}) {
  return (
    <Svg
      width={height * LOGO_ASPECT}
      height={height}
      viewBox="0 0 840 240"
      accessibilityRole="image"
      accessibilityLabel="HELF"
    >
      <G fill={color}>
        {/* H */}
        <Rect x={40} y={40} width={40} height={160} rx={6} />
        <Rect x={190} y={40} width={40} height={160} rx={6} />
        <Rect x={70} y={101} width={130} height={38} rx={6} />
        {/* L */}
        <Rect x={456} y={40} width={40} height={160} rx={6} />
        <Rect x={456} y={162} width={150} height={38} rx={6} />
        {/* F */}
        <Rect x={644} y={40} width={40} height={160} rx={6} />
        <Rect x={644} y={40} width={150} height={38} rx={6} />
        <Rect x={644} y={101} width={122} height={38} rx={6} />
      </G>
      {/* E — the brand's three bars, fixed colours */}
      <Rect x={268} y={40} width={150} height={38} rx={19} fill={E_TOP} />
      <Rect x={268} y={101} width={105} height={38} rx={19} fill={E_MIDDLE} />
      <Rect x={268} y={162} width={150} height={38} rx={19} fill={E_BOTTOM} />
    </Svg>
  );
}
