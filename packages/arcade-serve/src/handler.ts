import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServeConfig } from './config.js';
import { NOT_FOUND_PAGE, SERVER_ERROR_PAGE } from './error-page.js';
import { securityHeaders } from './headers.js';
import { Metrics } from './metrics.js';
import { canonicalContentType } from './mime.js';
import {
  isValidSlug,
  isValidVersionId,
  matchRoute,
  normaliseAssetPath,
  normaliseManifestPath,
} from './paths.js';
import { verifyPreviewToken } from './preview-token.js';
import type { AssetStore, Catalog, GameRecord, Manifest, ManifestFile, VersionRecord } from './types.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const LIVE_REDIRECT_CACHE = 'public, max-age=5';
const SDK_CACHE = 'public, max-age=3600';
const NO_STORE = 'no-store';

export interface LogRecord {
  slug?: string;
  versionId?: string;
  assetPath?: string;
  status: number;
  bytes?: number;
  route: string;
  reason?: string;
}

export interface HandlerDeps {
  config: ServeConfig;
  catalog: Catalog;
  assets: AssetStore;
  /** Contents of sdk/gatewaze-arcade.js, read once at boot. */
  sdkSource: string;
  metrics?: Metrics;
  now?: () => number;
  log?: (record: LogRecord) => void;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export function createHandler(deps: HandlerDeps): Handler {
  const { config, catalog, assets } = deps;
  const metrics = deps.metrics ?? new Metrics();
  const now = deps.now ?? (() => Date.now());
  const log =
    deps.log ??
    ((record: LogRecord) => {
      console.log(JSON.stringify({ svc: 'arcade-serve', ...record }));
    });

  const baseHeaders = () => securityHeaders({ portalOrigin: config.portalOrigin });
  const gameHeaders = (game: GameRecord) =>
    securityHeaders({ portalOrigin: config.portalOrigin, cspExceptions: game.cspExceptions });

  function send(
    res: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body: string | null,
    isHead: boolean,
  ): void {
    const payload = body === null ? null : Buffer.from(body, 'utf8');
    const out = { ...headers };
    if (payload) out['Content-Length'] = String(payload.byteLength);
    res.writeHead(status, out);
    if (isHead || !payload) {
      res.end();
      return;
    }
    res.end(payload);
  }

  function notFound(res: ServerResponse, isHead: boolean, ctx: LogRecord, game?: GameRecord): void {
    const headers = {
      ...(game ? gameHeaders(game) : baseHeaders()),
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': NO_STORE,
    };
    send(res, 404, headers, NOT_FOUND_PAGE, isHead);
    metrics.request(ctx.route, 404);
    log({ ...ctx, status: 404 });
  }

  function serverError(res: ServerResponse, isHead: boolean, ctx: LogRecord): void {
    const headers = {
      ...baseHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': NO_STORE,
    };
    send(res, 500, headers, SERVER_ERROR_PAGE, isHead);
    metrics.request(ctx.route, 500);
    log({ ...ctx, status: 500 });
  }

  /**
   * `published` versions are served openly; `draft`/`archived` need a valid
   * `?p=` preview token bound to this exact version. Every failure mode returns
   * the same "not found", so the origin never confirms that an unpublished
   * version exists.
   */
  function previewAllowed(game: GameRecord, versionId: string, token: string | null): boolean {
    if (game.status === 'published') return true;
    const result = verifyPreviewToken(token, versionId, config.previewSecrets, now());
    if (!result.ok) metrics.incr(`preview_rejected_${result.reason}`);
    return result.ok;
  }

  function manifestLookup(manifest: Manifest, wanted: string): ManifestFile | null {
    for (const file of manifest.files ?? []) {
      if (normaliseManifestPath(file?.path) === wanted) return file;
    }
    return null;
  }

  async function serveAsset(
    res: ServerResponse,
    isHead: boolean,
    game: GameRecord,
    version: VersionRecord,
    rawAssetPath: string,
    ctx: LogRecord,
  ): Promise<void> {
    const manifest = version.manifest;
    let wanted: string | null;

    if (rawAssetPath === '') {
      // The version index: whatever the manifest declares as the entry file.
      wanted = normaliseManifestPath(manifest?.entry);
    } else {
      wanted = normaliseAssetPath(rawAssetPath);
      if (wanted === null) metrics.incr('path_rejected');
    }
    if (wanted === null) {
      notFound(res, isHead, { ...ctx, reason: 'path_rejected' }, game);
      return;
    }

    const file = manifestLookup(manifest, wanted);
    if (!file) {
      // The manifest is the authority. An object may well exist in storage under
      // this key; if the manifest does not list it, it is not servable.
      metrics.incr('manifest_miss');
      notFound(res, isHead, { ...ctx, assetPath: wanted, reason: 'not_in_manifest' }, game);
      return;
    }

    const contentType = canonicalContentType(file.content_type);
    if (!contentType) {
      metrics.incr('content_type_rejected');
      notFound(res, isHead, { ...ctx, assetPath: wanted, reason: 'content_type' }, game);
      return;
    }

    const prefix = version.storagePrefix.endsWith('/') ? version.storagePrefix : `${version.storagePrefix}/`;
    const object = await assets.read(`${prefix}${wanted}`);
    if (!object) {
      metrics.incr('storage_miss');
      notFound(res, isHead, { ...ctx, assetPath: wanted, reason: 'storage_miss' }, game);
      return;
    }

    const headers: Record<string, string> = {
      ...gameHeaders(game),
      'Content-Type': contentType,
      'Cache-Control': IMMUTABLE,
    };
    // Only ever advertise a length measured from the same read as the stream
    // being sent. The manifest's recorded size is not a substitute: if it ever
    // disagreed with the object, the mismatch between Content-Length and the
    // piped bytes is the classic response-desync precondition behind a
    // keep-alive reverse proxy. No measured size → omit and let it chunk.
    const bytes = object.bytes ?? null;
    if (bytes !== null) headers['Content-Length'] = String(bytes);

    res.writeHead(200, headers);
    metrics.request(ctx.route, 200);
    log({ ...ctx, assetPath: wanted, status: 200, bytes: bytes ?? undefined });

    if (isHead) {
      object.stream.destroy();
      res.end();
      return;
    }
    object.stream.on('error', () => res.destroy());
    object.stream.pipe(res);
  }

  return function handle(req: IncomingMessage, res: ServerResponse): void {
    const method = req.method ?? 'GET';
    const isHead = method === 'HEAD';

    // `req.url` is a path, but parse it through URL against a fixed base so a
    // hostile absolute-form request line cannot change what we match on.
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://arcade.invalid');
    } catch {
      send(res, 400, { ...baseHeaders(), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': NO_STORE }, NOT_FOUND_PAGE, isHead);
      metrics.request('none', 400);
      return;
    }

    const route = matchRoute(url.pathname);
    const routeName = route.kind;

    if (method !== 'GET' && method !== 'HEAD') {
      send(
        res,
        405,
        { ...baseHeaders(), Allow: 'GET, HEAD', 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': NO_STORE },
        NOT_FOUND_PAGE,
        isHead,
      );
      metrics.request(routeName, 405);
      return;
    }

    void (async () => {
      try {
        switch (route.kind) {
          case 'health': {
            send(res, 200, { ...baseHeaders(), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NO_STORE }, 'ok\n', isHead);
            metrics.request(routeName, 200);
            return;
          }
          case 'ready': {
            const ok = await catalog.ping();
            send(
              res,
              ok ? 200 : 503,
              { ...baseHeaders(), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NO_STORE },
              ok ? 'ready\n' : 'not ready\n',
              isHead,
            );
            metrics.request(routeName, ok ? 200 : 503);
            return;
          }
          case 'metrics': {
            send(res, 200, { ...baseHeaders(), 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': NO_STORE }, metrics.render(), isHead);
            metrics.request(routeName, 200);
            return;
          }
          case 'sdk': {
            send(
              res,
              200,
              { ...baseHeaders(), 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': SDK_CACHE },
              deps.sdkSource,
              isHead,
            );
            metrics.request(routeName, 200);
            return;
          }
          case 'redirect-slash': {
            send(res, 302, { ...baseHeaders(), Location: route.to, 'Cache-Control': LIVE_REDIRECT_CACHE }, null, isHead);
            metrics.request(routeName, 302);
            return;
          }
          case 'live': {
            if (config.strictHost && !hostMatches(req, config)) {
              notFound(res, isHead, { route: routeName, status: 404, reason: 'host_mismatch' });
              return;
            }
            const found = await catalog.bySlug(route.slug);
            // The live route is published-only: an unpublished game has no
            // public address, and a preview link always names its version.
            if (!found || found.game.status !== 'published' || !found.game.liveVersionId || !found.liveVersion) {
              notFound(res, isHead, { route: routeName, slug: route.slug, status: 404, reason: 'no_live_version' });
              return;
            }
            // Re-validate before building a header value. These come from the
            // DB, and everything else here (csp_exceptions, manifest paths, URL
            // segments) is re-checked rather than trusted for its schema shape;
            // a malformed row should 404, not become a 500 from ERR_INVALID_CHAR.
            if (!isValidSlug(found.game.slug) || !isValidVersionId(found.liveVersion.id)) {
              notFound(res, isHead, { route: routeName, slug: route.slug, status: 404, reason: 'malformed_row' });
              return;
            }
            const target = `/g/${found.game.slug}/v/${found.liveVersion.id}/`;
            send(
              res,
              302,
              { ...gameHeaders(found.game), Location: target, 'Cache-Control': LIVE_REDIRECT_CACHE },
              null,
              isHead,
            );
            metrics.request(routeName, 302);
            log({ route: routeName, slug: route.slug, versionId: found.liveVersion.id, status: 302 });
            return;
          }
          case 'version': {
            if (config.strictHost && !hostMatches(req, config)) {
              notFound(res, isHead, { route: routeName, status: 404, reason: 'host_mismatch' });
              return;
            }
            const ctx: LogRecord = {
              route: routeName,
              slug: route.slug,
              versionId: route.versionId,
              assetPath: route.assetPath || '(entry)',
              status: 0,
            };
            const found = await catalog.byVersion(route.slug, route.versionId);
            if (!found) {
              notFound(res, isHead, { ...ctx, reason: 'unknown_version' });
              return;
            }
            if (!previewAllowed(found.game, route.versionId, url.searchParams.get('p'))) {
              notFound(res, isHead, { ...ctx, reason: 'preview_required' });
              return;
            }
            await serveAsset(res, isHead, found.game, found.version, route.assetPath, ctx);
            return;
          }
          default: {
            notFound(res, isHead, { route: 'none', status: 404, reason: 'no_route' });
          }
        }
      } catch (err) {
        console.error('[arcade-serve] request failed:', err instanceof Error ? err.message : String(err));
        metrics.incr('internal_error');
        if (!res.headersSent) serverError(res, isHead, { route: routeName, status: 500 });
        else res.destroy();
      }
    })();
  };
}

function hostMatches(req: IncomingMessage, config: ServeConfig): boolean {
  const host = (req.headers.host ?? '').toLowerCase();
  return host === new URL(config.playOrigin).host.toLowerCase();
}
