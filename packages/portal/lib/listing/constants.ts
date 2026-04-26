/**
 * Portal listing constants. Centralised so any tuning is reviewed in one
 * place rather than scattered across pages/hooks.
 */

/**
 * Hard ceiling on the rows the client will accumulate in memory.
 *
 * The cap exists as a circuit-breaker against runaway scroll sessions —
 * not as a UX-driven limit. With DOM virtualization in
 * `<TimelineContent>` (window-virtualizer keeps rendered nodes bounded
 * regardless of array size) the constraint is JS heap, not paint cost.
 *
 * 50k rows × ~1KB/row (portal projection) ≈ 50MB heap, comfortably
 * inside mobile-Safari budgets. Raise further only if a brand routinely
 * loads everything; in practice filters keep the working set far smaller.
 */
export const MAX_ACCUMULATED_ROWS = 50000;

/**
 * Auto-load back-off when the client-side post-filter (e.g. nearMe) is
 * stripping every server page. After this many empty pages we stop
 * loading and surface "no matches" UI rather than burning through the
 * whole dataset chasing zero results.
 */
export const NEAR_ME_AUTO_LOAD_LIMIT = 5;

/** Default page size used for SSR + first client load. */
export const DEFAULT_PORTAL_PAGE_SIZE = 50;

/** IntersectionObserver pre-fetch margin. */
export const SENTINEL_ROOT_MARGIN = '800px';
