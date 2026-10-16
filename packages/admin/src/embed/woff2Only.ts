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

/** Matches `, url(<…>.woff) format('woff')`: one WOFF entry after another source. */
const WOFF_FALLBACK = /,\s*url\(\s*(['"]?)[^'")]*\.woff\1\s*\)\s*format\(\s*(['"])woff\2\s*\)/g;

/** True for the @fontsource stylesheets this transform is for. */
export function isFontsourceCss(id: string): boolean {
  return /[\\/]@fontsource[\\/][^\\/]+[\\/][^\\/]+\.css(\?.*)?$/.test(id);
}

/**
 * Removes the WOFF fallback from each @font-face whose `src` also has WOFF2.
 * Throws when a face would be left with no WOFF2 source, so a change in how
 * @fontsource writes its CSS fails the build instead of silently dropping a
 * font.
 */
export function dropWoffFallbacks(css: string): string {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (face) => {
    if (!/\.woff2['"]?\s*\)\s*format\(\s*['"]woff2['"]\s*\)/.test(face)) {
      if (/\.woff['"]?\s*\)/.test(face)) {
        throw new Error('[woff2Only] an @font-face lists WOFF without WOFF2; refusing to drop it');
      }
      return face;
    }
    return face.replace(WOFF_FALLBACK, '');
  });
}
