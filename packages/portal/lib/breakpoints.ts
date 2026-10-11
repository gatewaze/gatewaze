/**
 * Shared viewport breakpoints for behaviour that differs on phones.
 *
 * These exist because two unrelated places need to agree on what "mobile"
 * means, and a copied number would drift:
 *
 *   - `components/timeline/useNearestCenterGlow.ts` only lights the
 *     nearest-to-centre card below this width, because touch devices have no
 *     hover to drive the glow.
 *   - `components/ui/GradientWaveBackground.tsx` paints the shader once and
 *     freezes it below this width, because an animating WebGL backdrop under
 *     cards that each `backdrop-filter: blur` it is too expensive on a phone.
 *
 * This is a BEHAVIOUR breakpoint and deliberately not one of Tailwind's. It
 * sits above `lg` (1024px is too wide) and above the card's own `sm` switch at
 * 640px, so a large phone in landscape is still treated as a phone.
 */
export const MOBILE_MAX_WIDTH_PX = 820;

/** Ready-made media query string for the above. */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;
