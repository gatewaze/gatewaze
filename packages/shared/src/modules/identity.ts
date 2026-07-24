/**
 * Module identity resolution — spec-module-namespacing-contribution-points §3-4.
 *
 * Separates the four jobs the old flat `id` conflated:
 *   - slug         : the module's short handle (its config.id / folder name),
 *                    unique only WITHIN a source.
 *   - sourceSlug   : a stable, filesystem-safe id for the source the module
 *                    came from (e.g. `gatewaze-modules`, `lf-gatewaze-modules`).
 *   - qualifiedId  : `${sourceSlug}/${slug}` — always globally unique.
 *   - resolvedId   : the display/route/capability identity — the bare slug when
 *                    the (source, slug) is reserved, else the qualifiedId.
 *
 * The DB PK (`installed_modules.id`) is immutable and set once; resolvedId is
 * the mutable one. These helpers are pure so they are trivially unit-testable
 * and identical across loader (deterministic parts) and reconcile (resolvedId,
 * which needs the reservation table).
 */

import { modulesRoot } from './module-paths';

/** Lowercase + collapse anything non-alphanumeric to single hyphens. */
export function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

/**
 * Derive a stable source slug for the source a module resolved from.
 *
 * Priority:
 *   1. a mounted source dir `/…/<repo>/modules/<slug>` → `<repo>` (dev + prod
 *      MODULE_SOURCES mounts; the dominant local case).
 *   2. the upstream cache `/…/sources/<repo-slug>/<module-slug>` → `<repo-slug>`.
 *   3. a human source label (kebab-cased) when no path is available.
 *   4. `bundled` as the last resort (baked-in modules with no distinct source).
 *
 * NB: the production live-serving tree is `<dataRoot>/modules/<id>` with NO repo
 * segment — the segment before `modules` is the data dir (e.g. `gatewaze`), NOT
 * a source. We detect that (path under `modulesRoot()`) and fall back to
 * `bundled` rather than mis-deriving. For grandfathered modules the value is
 * cosmetic anyway — they are reserved, so resolvedId is the bare slug regardless.
 */
export function deriveSourceSlug(
  resolvedDir: string | undefined,
  fallbackLabel?: string,
): string {
  if (resolvedDir) {
    // Live-serving tree (<dataRoot>/modules/<id>) carries no source repo — the
    // segment before `modules` is the data dir, so don't derive from it.
    const inLiveTree = resolvedDir.startsWith(modulesRoot() + '/') || resolvedDir === modulesRoot();
    if (!inLiveTree) {
      const parts = resolvedDir.split('/').filter(Boolean);
      const modIdx = parts.lastIndexOf('modules');
      if (modIdx > 0) return kebab(parts[modIdx - 1]);
      const srcIdx = parts.lastIndexOf('sources');
      if (srcIdx >= 0 && parts.length > srcIdx + 1) return kebab(parts[srcIdx + 1]);
    }
  }
  if (fallbackLabel && fallbackLabel.trim()) return kebab(fallbackLabel);
  return 'bundled';
}

export interface ModuleIdentity {
  slug: string;
  sourceSlug: string;
  qualifiedId: string;
  /** Only known once reservations are consulted (reconcile); loader leaves undefined. */
  resolvedId?: string;
}

/** Deterministic identity (no reservation needed): slug, sourceSlug, qualifiedId. */
export function computeIdentity(slug: string, sourceSlug: string): ModuleIdentity {
  return { slug, sourceSlug, qualifiedId: `${sourceSlug}/${slug}` };
}

/**
 * Resolve the display identity given whether the (source, slug) is reserved.
 * Reserved → bare slug (vanity); unreserved → the scoped qualifiedId.
 */
export function resolveDisplayId(identity: ModuleIdentity, isReserved: boolean): string {
  return isReserved ? identity.slug : identity.qualifiedId;
}
