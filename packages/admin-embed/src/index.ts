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
 * when EMBED_CONTRACT changes.
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
   * to the module namespace.
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
}

export interface GwLoaderHandle extends GwEmbedHandle {
  /**
   * Resolves with the manifest once the embed is mounted, or null when
   * loading failed (reported through `onFatal`) or the handle was unmounted
   * first. Never rejects.
   */
  ready: Promise<GwEmbedManifest | null>;
}

interface EmbedEntryModule {
  mount: (el: HTMLElement, ctx: GwHostContext) => GwEmbedHandle;
  version?: string;
}

const STYLE_ATTR = 'data-gw-embed-stylesheet';

function isAllowedBaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  try {
    const u = new URL(value);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
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
    typeof m.stylesheet === 'string' && m.stylesheet !== ''
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
  return body;
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
 * Load the deployment's embed and mount it into `el`. Returns synchronously:
 * the embed mounts when `ready` resolves, and `unmount()` before then
 * cancels the mount. Never throws — every failure reports through
 * `ctx.onFatal` (and a console warning) and resolves `ready` with null.
 */
export function mount(el: HTMLElement, ctx: GwLoaderContext): GwLoaderHandle {
  let cancelled = false;
  let inner: GwEmbedHandle | null = null;

  const handle: GwLoaderHandle = {
    unmount() {
      cancelled = true;
      inner?.unmount();
      inner = null;
    },
    ready: Promise.resolve(null),
  };

  if (!ctx || typeof ctx !== 'object' || !ctx.source || !isAllowedBaseUrl(ctx.source.baseUrl)) {
    fatal(ctx ?? {}, {
      error_type: 'config_invalid',
      code: 'gw_ctx_source_invalid',
      message: 'source.baseUrl must be an absolute https URL (http only for localhost)',
      field: 'source.baseUrl',
      recoverable: false,
    });
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

    let entry: EmbedEntryModule;
    try {
      // Stylesheet first so the first paint is styled. Both URLs are
      // manifest-relative, so a bundle served from a sub-path still resolves.
      await ensureStylesheet(sameOriginFile(manifest.stylesheet, base).href, source);
      // The bundle's build rewrote every import.meta.env.VITE_* read into
      // globalThis.__GATEWAZE_CONFIG__.VITE_*, and some of those run while
      // the module is being evaluated — before mount() could set the global.
      // Seed it here with the same values mount() applies (so its own
      // assignment is a no-op), or the import itself throws.
      (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ = {
        VITE_SUPABASE_URL: hostCtx.supabase.url,
        VITE_SUPABASE_ANON_KEY: hostCtx.supabase.anonKey,
        VITE_API_URL: hostCtx.apiBaseUrl === '' ? '/api/gw' : hostCtx.apiBaseUrl,
      };
      const entryUrl = sameOriginFile(manifest.entry, base).href;
      // Not a bundler-time import: the URL is only known at runtime, and the
      // whole point is that it is not part of the host's build.
      const importEntry = source.importEntry ?? ((url: string) => import(/* @vite-ignore */ /* webpackIgnore: true */ url));
      entry = (await importEntry(entryUrl)) as EmbedEntryModule;
      if (typeof entry.mount !== 'function') throw new Error('entry has no mount()');
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

    hostCtx.telemetry?.({ name: 'gw_embed_loaded', loader: version, embed: manifest.version, contract: manifest.contract });
    inner = entry.mount(el, hostCtx);
    return manifest;
  })();

  return handle;
}

export default mount;
