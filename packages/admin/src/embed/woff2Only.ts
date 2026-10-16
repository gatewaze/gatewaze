/**
 * Build-time transform for the embed's stylesheet (vite.embed.config.ts):
 * drops the WOFF fallback from every @font-face that also lists WOFF2.
 *
 * The embed is a library build, and Vite inlines every asset a library build
 * references, so each `url(...)` in an @font-face becomes base64 inside the
 * one stylesheet. @fontsource lists WOFF2 then WOFF for every face, which put
 * both copies of all 28 Inter faces into the embed CSS: about 0.6 MB of WOFF
 * that no browser running the embed ever reads.
 *
 * Nothing changes on screen: a browser takes the first `src` it supports, and
 * every browser that can run the embed supports WOFF2. The bundle targets
 * Vite's default (baseline widely available: Chrome 111, Edge 111, Firefox
 * 114, Safari 16.4), and WOFF2 shipped long before each of those (Chrome 36,
 * Firefox 39, Safari 12). So the WOFF entry was only ever reached in browsers
 * that cannot run the bundle at all.
 *
 * Only the embed build uses it. The standalone app serves fonts as separate
 * files, where the browser already downloads only the WOFF2.
 */

// An optional ?query or #fragment after the file extension, inside url().
const SUFFIX = `(?:[?#][^'")]*)?`;

/** Matches `, url(<…>.woff) format('woff')`: one WOFF entry after another source. */
const WOFF_FALLBACK = new RegExp(`,\\s*url\\(\\s*(['"]?)[^'")?#]*\\.woff${SUFFIX}\\1\\s*\\)\\s*format\\(\\s*(['"])woff\\2\\s*\\)`, 'g');
const HAS_WOFF2 = new RegExp(`\\.woff2${SUFFIX}['"]?\\s*\\)\\s*format\\(\\s*['"]woff2['"]\\s*\\)`);

/** True for the @fontsource stylesheets this transform is for. */
export function isFontsourceCss(id: string): boolean {
  return /[\\/]@fontsource[\\/][^\\/]+[\\/][^\\/]+\.css(\?.*)?$/.test(id);
}

/**
 * Removes the WOFF fallback from each @font-face whose `src` also has WOFF2.
 * A face without a WOFF2 source is left exactly as it is, so no font can be
 * lost; inlinedWoffWarning() then reports it after the build.
 */
export function dropWoffFallbacks(css: string): string {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (face) => (HAS_WOFF2.test(face) ? face.replace(WOFF_FALLBACK, '') : face));
}

/**
 * Checks the built stylesheet, and returns a warning when any WOFF font is
 * still inlined: a face this transform could not handle, or the plugin no
 * longer running before Vite rewrites the url()s (it needs `enforce: 'pre'`).
 * A warning and not a failure: the image build treats a failed embed build
 * as "no embed", which would be far worse than a larger stylesheet.
 */
export function inlinedWoffWarning(css: string): string | null {
  return /data:font\/woff;/.test(css)
    ? '[woff2Only] the embed stylesheet still inlines WOFF fonts, so it is about 0.7 MB larger than it should be; check that the woff2-only plugin runs before Vite rewrites url()s'
    : null;
}
