/**
 * Empty stub for `jsdom` — same rationale as packages/admin/src/stubs/jsdom-empty.ts.
 *
 * The portal's `/api/ai-search` route imports `isomorphic-dompurify`
 * which pulls jsdom's `default-stylesheet.css` into the server bundle
 * via its Node code path. The next-build "Collect page data" step
 * then fails with ENOENT trying to read it from `.next/browser/`.
 *
 * Aliased in next.config.ts so the bundler resolves to this empty
 * module instead. The portal's API routes that need DOM sanitisation
 * use either `dompurify` directly (browser-only) or supabase RPCs.
 *
 * Server components emitting HTML use `sanitize-html` (already in
 * the bundle) which is jsdom-free.
 */

export class JSDOM {
  constructor() {
    throw new Error('jsdom is stubbed in the portal bundle — use sanitize-html or browser-side dompurify');
  }
}
export class VirtualConsole {}
export class CookieJar {}
export class ResourceLoader {}
export interface FromUrlOptions {}
export interface FromFileOptions {}
export interface BaseOptions {}
export interface ConstructorOptions {}
