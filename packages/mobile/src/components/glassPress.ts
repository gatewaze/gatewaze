/**
 * The numbers behind the press feedback on GlassCircleButton, kept in a plain
 * module so they can be unit tested without a React Native renderer.
 */

/** Opacity of the pressed fill. Below 1 so the glass still shows through. */
export const PRESS_FILL_ALPHA = 0.85;

/** Fade-in and fade-out of the pressed fill. Neither exceeds motion.quick. */
export const PRESS_FILL_IN_MS = 140;
export const PRESS_FILL_OUT_MS = 260;

/** Cross-fade between two glyphs when the icon name changes. */
export const SWAP_MS = 300;

/** Opacity of the rest-colour glyph and the pressed-colour glyph for a fill value. */
export function pressLayerOpacities(fill: number): { rest: number; pressed: number } {
  'worklet';
  const f = Math.min(1, Math.max(0, fill));
  return { rest: 1 - f, pressed: f };
}
