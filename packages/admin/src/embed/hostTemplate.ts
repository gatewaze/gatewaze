/**
 * The host's newsletter-template preference (GwHostContext.resolveTemplateCollection).
 *
 * Module-level for the same reason as portalContainer.ts and hostNotify.ts: the consumer is a
 * plain async function in the newsletters module (`admin/utils/collectionResolver.ts`), not a
 * component, so there is no provider to thread it through. One live mount per page
 * (tryRegisterMount) makes a single value unambiguous.
 *
 * Held as the host's FUNCTION rather than a resolved slug. The host's scope changes without the
 * embed remounting — it syncs its project query param without a navigation, and a cold deep link
 * resolves its scope after mount — so a value captured here at mount would be wrong for the rest
 * of the session. Calling through means every lookup sees the scope as it is now.
 *
 * Null means "no host preference", which is the standalone admin and any host that does not
 * implement this optional part of the contract. Callers then keep their existing behaviour.
 */
let resolveTemplateCollection: (() => string) | null = null;

/** Called by mount() before the tree renders, and again with null on unmount. */
export function setHostTemplateResolver(fn: (() => string) | null | undefined): void {
  resolveTemplateCollection = fn ?? null;
}

/**
 * The collection slug the host wants for the scope in view, or null if it has no preference.
 *
 * Never throws: a host callback that fails must not take the editor down with it, so a thrown
 * error is treated as "no preference" and the caller falls back to its own default.
 */
export function getHostTemplateCollectionSlug(): string | null {
  if (!resolveTemplateCollection) return null;

  try {
    const slug = resolveTemplateCollection();
    return typeof slug === 'string' && slug.length > 0 ? slug : null;
  } catch (err) {
    console.warn('[gw-embed] host resolveTemplateCollection threw; ignoring the preference', err);
    return null;
  }
}
