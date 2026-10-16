/**
 * @gatewaze/admin-embed — loader for the hosted embeddable admin.
 *
 * The admin image serves a library build of itself under /embed/ (see
 * packages/admin/vite.embed.config.ts): a manifest.json naming the current
 * content-hashed entry and stylesheet, plus the files. This package is the
 * small, stable piece a host application installs: it reads the manifest,
 * checks the host contract, injects the stylesheet and imports the entry.
 *
 * Because the bundle comes from the deployment the host talks to, the host
 * never needs a new release to pick up an admin change — the embed moves
 * with the backend it was built for. The host only upgrades this package
 * when EMBED_CONTRACT changes, or to use an optional capability the
 * manifest advertises (e.g. 'host-session').
 */
// The contract is the admin's own file, imported by path so the loader can
// never drift from what the embed implements. Type-only, so nothing is
// emitted for it; scripts/build.mjs ships a copy as dist/types.d.ts and
// repoints this specifier in the declarations.
import type { GwEmbedFatalError, GwEmbedHandle, GwHostContext } from '../../admin/src/embed/types';

export type * from '../../admin/src/embed/types';

// Both stamped by scripts/build.mjs so dist/index.js is one self-contained
// file: the contract from packages/admin/src/embed/contract.ts, the version
// from package.json.
declare const __EMBED_CONTRACT__: number;
declare const __ADMIN_EMBED_VERSION__: string;

/** Host contract version this loader was built for (see the admin's embed/contract.ts). */
export const EMBED_CONTRACT: number = __EMBED_CONTRACT__;

/** Loader version, logged alongside the manifest version at mount. */
export const version: string = __ADMIN_EMBED_VERSION__;

/** Where the hosted embed lives and how its stylesheet reaches the page. */
export interface GwEmbedSource {
  /**
   * Absolute URL of the deployment's embed directory, with or without a
   * trailing slash — e.g. `https://admin.example.org/embed`. Must be https
   * (http is allowed for localhost only).
   */
  baseUrl: string;
  /**
   * Replaces the stylesheet URL the manifest names (absolute, same origin as
   * `baseUrl`) with the one to fetch. A host that scopes the stylesheet on
   * its own server points this at that endpoint, keyed by the hashed file
   * name, so the scoping runs once per build rather than in every browser.
   * The returned URL is fetched as-is; same-origin and cross-origin both
   * work, credentials are never sent.
   */
  resolveStylesheetUrl?: (url: string) => string;
  /**
   * Rewrites the fetched stylesheet before it is injected. A host that
   * renders the admin inside its own chrome scopes the rules to its
   * container here; the embed ships them unscoped.
   */
  transformStylesheet?: (css: string) => string;
  /** Element the `<style>` is appended to. Defaults to `document.head`. */
  stylesheetTarget?: HTMLElement;
  /**
   * How the entry module is imported. Defaults to a native dynamic
   * `import(url)`; a host whose module loading has to go through its own
   * mechanism (a CSP nonce, a custom loader) supplies one here. Must resolve
   * to the module namespace. When set, the loader adds no
   * `<link rel="modulepreload">` tags (see GwEmbedManifest.preload), since
   * a host that controls module loading may not allow them.
   */
  importEntry?: (url: string) => Promise<unknown>;
}

/** The host context plus where to load the embed from. */
export type GwLoaderContext = GwHostContext & { source: GwEmbedSource };

/** The deployment's /embed/manifest.json. */
export interface GwEmbedManifest {
  /** Host contract version the bundle implements; must equal EMBED_CONTRACT. */
  contract: number;
  /** Release the bundle was built from (the image tag, or "dev"). */
  version: string;
  entry: string;
  stylesheet: string;
  /** Module ids compiled into this bundle. */
  modules: string[];
  builtAt: string;
  /**
   * Optional features the bundle supports (the admin's EMBED_CAPABILITIES),
   * e.g. 'host-session'. Absent on bundles built before it existed, which
   * support none.
   */
  capabilities?: string[];
  /**
   * Chunks the entry imports statically, relative to the manifest, entry
   * excluded. The loader preloads each one with `<link rel="modulepreload">`
   * while the entry downloads. Optional: absent on bundles built before it
   * existed, and ignored by loaders before 1.2.0.
   */
  preload?: string[];
}

/** Manifest capability a bundle needs to honour GwHostContext.session. */
export const HOST_SESSION_CAPABILITY = 'host-session';

/** Manifest capability: the bundle dispatches FIRST_PAINT_EVENT on the mount element. */
export const FIRST_PAINT_CAPABILITY = 'first-paint';

/** Manifest capability: the bundle honours GwHostContext.loadingIndicator. */
export const HOST_LOADING_INDICATOR_CAPABILITY = 'host-loading-indicator';

/**
 * The event a 'first-paint' bundle dispatches on the mount element. The same
 * name as FIRST_PAINT_EVENT in the admin's embed/contract.ts (a test checks).
 */
export const FIRST_PAINT_EVENT = 'gw-embed:first-paint';

/** Most preload entries the loader acts on; the rest are left to the browser's own discovery. */
export const MAX_PRELOADS = 64;

/** A manifest listing more preloads than this is refused as malformed, before any is checked. */
export const MAX_MANIFEST_PRELOADS = 256;

export interface GwLoaderHandle extends GwEmbedHandle {
  /**
   * Resolves with the manifest once the embed is mounted, or null when
   * loading failed (reported through `onFatal`) or the handle was unmounted
   * first. Never rejects.
   */
  ready: Promise<GwEmbedManifest | null>;
  /**
   * Resolves once the embed has put something on screen: its first route
   * content or loading spinner has committed. Use it to hide the host's own
   * loading state without leaving a blank pane in between. For a bundle
   * without the 'first-paint' capability it resolves when `ready` does.
   * Also resolves when loading fails, when the embed reports a fatal error
   * after mounting, and on `unmount()`. Never rejects.
   */
  rendered: Promise<void>;
}

interface EmbedEntryModule {
  mount: (el: HTMLElement, ctx: GwHostContext) => GwEmbedHandle;
  version?: string;
}

const STYLE_ATTR = 'data-gw-embed-stylesheet';
const PRELOAD_ATTR = 'data-gw-embed-preload';

function isAllowedBaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  try {
    const u = new URL(value);
    if (u.protocol === 'https:') return true;
    // http only for local development: localhost, 127.0.0.1 and *.localhost
    // (e.g. supabase.gatewaze.localhost), which browsers resolve to loopback.
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.localhost'));
  } catch {
    return false;
  }
}

function fatal(ctx: Pick<GwHostContext, 'onFatal'>, error: GwEmbedFatalError): void {
  console.warn(`[gw-embed] ${error.code}: ${error.message}`);
  ctx.onFatal?.(error);
}

function isManifest(v: unknown): v is GwEmbedManifest {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.contract === 'number' &&
    typeof m.version === 'string' &&
    typeof m.entry === 'string' && m.entry !== '' &&
    typeof m.stylesheet === 'string' && m.stylesheet !== '' &&
    (m.capabilities === undefined ||
      (Array.isArray(m.capabilities) && m.capabilities.every((c) => typeof c === 'string'))) &&
    (m.preload === undefined ||
      (Array.isArray(m.preload) &&
        m.preload.length <= MAX_MANIFEST_PRELOADS &&
        m.preload.every((p) => typeof p === 'string' && p !== '')))
  );
}

/**
 * Resolves a manifest file name against the embed base and insists it stays
 * on that origin. `new URL(x, base)` ignores `base` when `x` is already
 * absolute, so without this a manifest could point the import at any origin
 * — and the host only agreed to load code from `source.baseUrl`.
 */
function sameOriginFile(name: string, base: URL): URL {
  const url = new URL(name, base);
  if (url.origin !== base.origin) throw new Error('manifest names a file on another origin');
  return url;
}

async function fetchManifest(base: URL): Promise<GwEmbedManifest> {
  const res = await fetch(new URL('manifest.json', base).href, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error(`manifest responded ${res.status}`);
  const body: unknown = await res.json();
  if (!isManifest(body)) throw new Error('manifest is malformed');
  sameOriginFile(body.entry, base);
  sameOriginFile(body.stylesheet, base);
  // Held to the same rule as the entry: a preload is code the browser fetches
  // from wherever the manifest says.
  for (const p of body.preload ?? []) sameOriginFile(p, base);
  return body;
}

/**
 * Adds `<link rel="modulepreload">` for each preload file not already linked,
 * so the browser fetches the entry's static imports alongside it. Purely a
 * hint: a failed or skipped preload only means the import fetches the file
 * itself, as before.
 */
function preloadModules(files: string[], base: URL): void {
  for (const file of files.slice(0, MAX_PRELOADS)) {
    const href = sameOriginFile(file, base).href;
    if (document.head.querySelector(`link[${PRELOAD_ATTR}="${CSS.escape(href)}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    // The bundle is served with CORS open to any origin and needs no
    // credentials; matches the mode of the dynamic import() that uses it.
    link.crossOrigin = 'anonymous';
    link.href = href;
    link.setAttribute(PRELOAD_ATTR, href);
    document.head.appendChild(link);
  }
}

async function ensureStylesheet(manifestHref: string, source: GwEmbedSource): Promise<void> {
  const target = source.stylesheetTarget ?? document.head;
  const href = source.resolveStylesheetUrl ? source.resolveStylesheetUrl(manifestHref) : manifestHref;
  // Re-mounts reuse the sheet; a new build has a new hashed name, so a stale
  // one is never matched.
  if (target.querySelector(`style[${STYLE_ATTR}="${CSS.escape(href)}"]`)) return;
  const res = await fetch(href, { credentials: 'omit' });
  if (!res.ok) throw new Error(`stylesheet responded ${res.status}`);
  const css = await res.text();
  const style = document.createElement('style');
  style.setAttribute(STYLE_ATTR, href);
  style.textContent = source.transformStylesheet ? source.transformStylesheet(css) : css;
  target.appendChild(style);
}

/**
 * How long `rendered` waits for a 'first-paint' bundle's signal after mount
 * before resolving anyway, so a bundle that never signals cannot keep a host
 * waiting on it for ever.
 */
export const FIRST_PAINT_TIMEOUT_MS = 10_000;

/**
 * Load the deployment's embed and mount it into `el`. Returns synchronously:
 * the embed mounts when `ready` resolves, and `unmount()` before then
 * cancels the mount. Never throws — every failure reports through
 * `ctx.onFatal` (and a console warning) and resolves `ready` with null.
 */
export function mount(el: HTMLElement, ctx: GwLoaderContext): GwLoaderHandle {
  let cancelled = false;
  let inner: GwEmbedHandle | null = null;

  // `rendered` settles exactly once, from whichever comes first: the bundle's
  // first-paint event, `ready` (for a bundle without the capability, or a
  // load that failed), a fatal error after mount, unmount, or the timeout.
  // Assigned synchronously by the Promise executor below, before any use.
  let resolveRendered!: () => void;
  const rendered = new Promise<void>((resolve) => {
    resolveRendered = resolve;
  });
  let stopWaiting: (() => void) | null = null;
  const settleRendered = () => {
    stopWaiting?.();
    stopWaiting = null;
    resolveRendered();
  };
  // Set once the load has started waiting for the bundle's signal.
  let awaitsFirstPaint = false;

  const handle: GwLoaderHandle = {
    unmount() {
      cancelled = true;
      inner?.unmount();
      inner = null;
      settleRendered();
    },
    ready: Promise.resolve(null),
    rendered,
  };

  if (!ctx || typeof ctx !== 'object' || !ctx.source || !isAllowedBaseUrl(ctx.source.baseUrl)) {
    fatal(ctx ?? {}, {
      error_type: 'config_invalid',
      code: 'gw_ctx_source_invalid',
      message: 'source.baseUrl must be an absolute https URL (http only for localhost, 127.0.0.1 or *.localhost)',
      field: 'source.baseUrl',
      recoverable: false,
    });
    settleRendered();
    return handle;
  }

  const { source, ...hostCtx } = ctx;
  const base = new URL(source.baseUrl.endsWith('/') ? source.baseUrl : `${source.baseUrl}/`);

  handle.ready = (async () => {
    let manifest: GwEmbedManifest;
    try {
      manifest = await fetchManifest(base);
    } catch (err) {
      fatal(hostCtx, {
        error_type: 'import_failed',
        code: 'gw_embed_manifest_unreachable',
        message: `Could not read the embed manifest: ${err instanceof Error ? err.message : 'unknown error'}`,
        recoverable: true,
      });
      return null;
    }

    if (manifest.contract !== EMBED_CONTRACT) {
      fatal(hostCtx, {
        error_type: 'import_failed',
        code: 'gw_embed_contract_mismatch',
        message: `The hosted embed implements host contract ${manifest.contract}; this loader was built for ${EMBED_CONTRACT}. Upgrade @gatewaze/admin-embed.`,
        recoverable: false,
      });
      return null;
    }

    const capabilities = manifest.capabilities ?? [];

    // A bundle that predates host-session mode would ignore `session` and keep
    // a localStorage session instead, so a host-session host must not mount it.
    // Keyed on `session !== undefined`, the same test the bundle's own
    // validation uses, so a malformed session can never slip past this check.
    if (hostCtx.session !== undefined && !capabilities.includes(HOST_SESSION_CAPABILITY)) {
      fatal(hostCtx, {
        error_type: 'import_failed',
        code: 'gw_embed_capability_missing',
        message: `The hosted embed (${manifest.version}) does not support host-session mode. Upgrade the Gatewaze deployment.`,
        recoverable: false,
      });
      return null;
    }

    let entry: EmbedEntryModule;
    try {
      // The bundle's build rewrote every import.meta.env.VITE_* read into
      // globalThis.__GATEWAZE_CONFIG__.VITE_*, and some of those run while
      // the module is being evaluated — before mount() could set the global.
      // Seed it here with the same values mount() applies (so its own
      // assignment is a no-op), or the import itself throws.
      (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ = {
        VITE_SUPABASE_URL: hostCtx.supabase.url,
        VITE_SUPABASE_ANON_KEY: hostCtx.supabase.anonKey,
        VITE_API_URL: hostCtx.apiBaseUrl === '' ? '/api/gw' : hostCtx.apiBaseUrl,
        ...(hostCtx.session !== undefined ? { VITE_AUTH_MODE: 'host-session' } : {}),
        // Only a URL that passes the bundle's own rule; the bundle validates
        // the full context at mount and rejects anything else.
        ...(typeof hostCtx.supabase.publicUrl === 'string' && isAllowedBaseUrl(hostCtx.supabase.publicUrl)
          ? { VITE_SUPABASE_PUBLIC_URL: hostCtx.supabase.publicUrl }
          : {}),
      };
      // All URLs are manifest-relative, so a bundle served from a sub-path
      // still resolves.
      const entryUrl = sameOriginFile(manifest.entry, base).href;
      // A host with its own module loading (importEntry) may not allow
      // preload links, so they are only added for the native import.
      if (!source.importEntry && manifest.preload) preloadModules(manifest.preload, base);
      // Not a bundler-time import: the URL is only known at runtime, and the
      // whole point is that it is not part of the host's build.
      const importEntry = source.importEntry ?? ((url: string) => import(/* @vite-ignore */ /* webpackIgnore: true */ url));
      // The stylesheet and the entry download in parallel; the embed mounts
      // only once both are in, so the first paint is still styled. Both are
      // awaited to the end, so a failure in one never leaves the other as an
      // unhandled rejection.
      const [sheet, imported] = await Promise.allSettled([
        ensureStylesheet(sameOriginFile(manifest.stylesheet, base).href, source),
        Promise.resolve().then(() => importEntry(entryUrl)),
      ]);
      if (sheet.status === 'rejected') throw sheet.reason;
      if (imported.status === 'rejected') throw imported.reason;
      entry = imported.value as EmbedEntryModule;
      if (!entry || typeof entry.mount !== 'function') throw new Error('entry has no mount()');
    } catch (err) {
      fatal(hostCtx, {
        error_type: 'import_failed',
        code: 'gw_embed_import_failed',
        message: `Could not load the embed bundle: ${err instanceof Error ? err.message : 'unknown error'}`,
        recoverable: true,
      });
      return null;
    }

    // The host may have moved on while we were fetching; mounting into a
    // node it has dropped would leak a React root.
    if (cancelled) return null;

    // A bundle without the capability has never heard of the field; leave
    // it out rather than hand it something it will not use.
    const { loadingIndicator, ...rest } = hostCtx;
    // A copy either way: the onFatal wrapper below must not write into the
    // host's own object.
    const mountCtx: GwHostContext =
      loadingIndicator !== undefined && capabilities.includes(HOST_LOADING_INDICATOR_CAPABILITY)
        ? { ...rest, loadingIndicator }
        : { ...rest };
    const hostOnFatal = hostCtx.onFatal;

    if (capabilities.includes(FIRST_PAINT_CAPABILITY)) {
      // Listening before mount, so a signal can never be missed.
      const onFirstPaint = () => settleRendered();
      el.addEventListener(FIRST_PAINT_EVENT, onFirstPaint, { once: true });
      const timer = setTimeout(() => {
        console.warn(`[gw-embed] no first-paint signal within ${FIRST_PAINT_TIMEOUT_MS}ms; resolving rendered anyway`);
        settleRendered();
      }, FIRST_PAINT_TIMEOUT_MS);
      stopWaiting = () => {
        el.removeEventListener(FIRST_PAINT_EVENT, onFirstPaint);
        clearTimeout(timer);
      };
      awaitsFirstPaint = true;
      // A fatal error after mount (a render crash) will never paint.
      mountCtx.onFatal = (error) => {
        settleRendered();
        hostOnFatal?.(error);
      };
    }

    hostCtx.telemetry?.({ name: 'gw_embed_loaded', loader: version, embed: manifest.version, contract: manifest.contract });
    try {
      inner = entry.mount(el, mountCtx);
    } catch (err) {
      // The bundle's own mount() never throws; a bundle that does must not
      // turn `ready` into a rejection.
      fatal(hostCtx, {
        error_type: 'render_crash',
        code: 'gw_embed_mount_failed',
        message: `The embed bundle failed to mount: ${err instanceof Error ? err.message : 'unknown error'}`,
        recoverable: false,
      });
      return null;
    }
    return manifest;
  })();

  void handle.ready.then(
    (manifest) => {
      if (!manifest || !awaitsFirstPaint) settleRendered();
    },
    () => settleRendered(),
  );

  return handle;
}

export default mount;
