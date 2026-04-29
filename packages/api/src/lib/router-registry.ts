import type { Application, Router, RequestHandler } from 'express';
import express from 'express';

export type AuthLabel = 'jwt' | 'public' | 'service-role';

interface RouteRecord {
  method: string;
  path: string;
  label: AuthLabel;
}

interface PendingRoute {
  method: string;
  relativePath: string;
}

interface LabeledRouterMeta {
  label: AuthLabel;
  pending: PendingRoute[];
}

const REGISTRY: RouteRecord[] = [];
const ROUTER_META = new WeakMap<Router, LabeledRouterMeta>();

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/**
 * Wraps an Express Router so every route registered through it is recorded
 * with an auth label. Pair with {@link mountLabeled} to mount it on an app
 * with a known prefix; the prefix is then prepended to every recorded route.
 *
 * Usage:
 *   const r = labeledRouter('jwt');
 *   r.get('/foo', handler);
 *   mountLabeled(app, '/api/things', r);
 */
export function labeledRouter(label: AuthLabel): Router {
  const router = express.Router();
  const meta: LabeledRouterMeta = { label, pending: [] };
  ROUTER_META.set(router, meta);

  for (const method of HTTP_METHODS) {
    const original = router[method].bind(router) as (
      path: string,
      ...handlers: RequestHandler[]
    ) => Router;
    (router[method] as unknown) = (path: string, ...handlers: RequestHandler[]) => {
      meta.pending.push({ method: method.toUpperCase(), relativePath: path });
      return original(path, ...handlers);
    };
  }
  return router;
}

/**
 * Mounts a labeledRouter on `app` at `mountPath` and records each of its
 * routes in the registry with the full path. Equivalent to
 * `app.use(mountPath, router)` plus bookkeeping.
 */
export function mountLabeled(app: Application, mountPath: string, router: Router): void {
  const meta = ROUTER_META.get(router);
  if (!meta) {
    throw new Error('mountLabeled: router was not created via labeledRouter()');
  }
  for (const route of meta.pending) {
    const fullPath = joinPaths(mountPath, route.relativePath);
    REGISTRY.push({ method: route.method, path: fullPath, label: meta.label });
  }
  app.use(mountPath, router);
}

/**
 * Records an auth label for a route mounted directly on `app` (not via
 * a Router). Use sparingly — prefer mountLabeled().
 */
export function labelDirectRoute(method: string, path: string, label: AuthLabel): void {
  REGISTRY.push({ method: method.toUpperCase(), path, label });
}

/**
 * Records an auth label covering ANY route under the given path
 * prefix. Used by the dynamic module-loader to opt module-registered
 * routes into the labelling system without requiring each module
 * author to call labeledRouter() (which they can't, since they
 * receive a plain Express app from apiRoutes(app, ctx)).
 *
 * The mount-prefix convention per spec §5.2 follow-up: every
 * module's `apiRoutes` callback registers routes under a prefix
 * computed from the module id (`/api/modules/<id>/...`). The core
 * loader calls `labelMountPrefix('/api/modules/<id>', 'jwt')` before
 * invoking the module's callback, so any route the module mounts
 * inherits the JWT label.
 */
const PREFIX_LABELS: Array<{ prefix: string; label: AuthLabel }> = [];

export function labelMountPrefix(prefix: string, label: AuthLabel): void {
  PREFIX_LABELS.push({ prefix, label });
}

function findPrefixLabel(path: string): AuthLabel | null {
  // Longest prefix wins (so `/api/modules/foo` beats `/api/modules`).
  let best: { prefix: string; label: AuthLabel } | null = null;
  for (const entry of PREFIX_LABELS) {
    if (path === entry.prefix || path.startsWith(entry.prefix + '/')) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.label ?? null;
}

/**
 * Walks the Express app's internal route table and asserts every declared
 * route was registered through a labeledRouter (or labelDirectRoute).
 *
 * Throws on any unlabeled route. Call once at the end of bootstrap.
 */
export function assertAllRoutesLabeled(app: Application): void {
  const declared = enumerateRoutes(app);
  const labeled = new Set(REGISTRY.map(r => `${r.method} ${normalize(r.path)}`));
  const missing: string[] = [];
  for (const route of declared) {
    const key = `${route.method} ${normalize(route.path)}`;
    if (labeled.has(key)) continue;
    // Fall back to prefix labels so dynamically-mounted module routes
    // are accepted as long as the loader pre-registered the prefix.
    if (findPrefixLabel(normalize(route.path)) !== null) continue;
    missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(
      `Routes lacking auth label: ${missing.join(', ')}. Use mountLabeled() / labelDirectRoute() / labelMountPrefix().`,
    );
  }
}

/**
 * @internal — exposed for tests.
 */
export function getRegistry(): readonly RouteRecord[] {
  return REGISTRY;
}

/**
 * @internal — exposed for tests.
 */
export function clearRegistry(): void {
  REGISTRY.length = 0;
  PREFIX_LABELS.length = 0;
}

interface DeclaredRoute {
  method: string;
  path: string;
}

interface ExpressLayer {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  regexp?: RegExp;
  handle?: { stack?: ExpressLayer[] };
}

function enumerateRoutes(app: Application): DeclaredRoute[] {
  const routes: DeclaredRoute[] = [];
  const router = (app as unknown as { _router?: { stack: ExpressLayer[] } })._router;
  if (!router) return routes;
  walk(router.stack, '', routes);
  return routes;
}

function walk(stack: ExpressLayer[], prefix: string, out: DeclaredRoute[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      for (const method of methods) {
        out.push({ method, path: prefix + layer.route.path });
      }
    } else if (layer.name === 'router' && layer.handle?.stack && layer.regexp) {
      const sub = stripRegexp(layer.regexp);
      walk(layer.handle.stack, prefix + sub, out);
    }
  }
}

/**
 * Best-effort recovery of a mount-path string from the regexp Express
 * compiles for `app.use(path, router)`. We don't depend on the exact
 * regexp shape — we strip leading/trailing artifacts and unescape slashes.
 */
function stripRegexp(rx: RegExp): string {
  const src = rx.source;
  // Strip leading `^` and any trailing assertion fragments common in
  // path-to-regexp output: `\/?(?=\/|$)`, `(?:\/(?=$))?`, etc.
  let stripped = src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\?\(\?=\$\)$/, '');
  stripped = stripped.replace(/\\\//g, '/');
  // path-to-regexp may end the pattern with /?(?:/(?=$))? — strip trailing /
  return stripped.replace(/\/$/, '');
}

function joinPaths(prefix: string, suffix: string): string {
  if (suffix === '/' || suffix === '') return normalize(prefix);
  return normalize(prefix + suffix);
}

function normalize(p: string): string {
  if (p === '') return '/';
  // Collapse trailing slash for comparison.
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}
