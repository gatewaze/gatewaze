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
 *
 * The stub is INTENTIONALLY non-throwing — `isomorphic-dompurify`'s
 * top-level code does `new JSDOM('').window` at module load, so a
 * throw would block the import chain (page-data collection then
 * fails). Instead JSDOM returns a fake window with the methods
 * DOMPurify probes for. None of the methods do anything real; if a
 * server route legitimately tries to sanitise HTML via this path,
 * the output is just the input — better to fail loud at runtime
 * than silently break the build.
 */

const noop = () => {};

interface FakeWindow {
  document: {
    createElement: () => Record<string, unknown>;
    createElementNS: () => Record<string, unknown>;
    createDocumentFragment: () => Record<string, unknown>;
    documentElement: Record<string, unknown>;
    implementation: Record<string, unknown>;
    addEventListener: () => void;
  };
  navigator: { userAgent: string };
  HTMLElement: typeof Object;
  Node: typeof Object;
  DocumentFragment: typeof Object;
  Element: typeof Object;
}

function fakeWindow(): FakeWindow {
  const fakeNode = { nodeType: 1, nodeName: '#stub', cloneNode: noop, removeChild: noop, appendChild: noop };
  return {
    document: {
      createElement: () => fakeNode,
      createElementNS: () => fakeNode,
      createDocumentFragment: () => fakeNode,
      documentElement: fakeNode,
      implementation: { createHTMLDocument: () => ({ documentElement: fakeNode }) },
      addEventListener: noop,
    },
    navigator: { userAgent: 'jsdom-stub' },
    HTMLElement: Object,
    Node: Object,
    DocumentFragment: Object,
    Element: Object,
  };
}

export class JSDOM {
  window: FakeWindow;
  constructor(_html?: string) {
    this.window = fakeWindow();
  }
  serialize() { return ''; }
}

export class VirtualConsole {
  on() { return this; }
  sendTo() { return this; }
}
export class CookieJar {}
export class ResourceLoader {}
export interface FromUrlOptions {}
export interface FromFileOptions {}
export interface BaseOptions {}
export interface ConstructorOptions {}

// Default export — some callers do `import jsdom from 'jsdom'` (uncommon
// but happens). Re-expose the named exports.
export default { JSDOM, VirtualConsole, CookieJar, ResourceLoader };
