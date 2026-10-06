/**
 * Version of the host contract (GwHostContext / GwEmbedHandle in types.ts)
 * that this embed build implements. Stamped into the hosted bundle's
 * manifest; the loader package refuses a manifest whose contract it was not
 * built for, so a host only has to upgrade the loader when this changes.
 *
 * Bump it for any change a host must adapt to: a required field added to
 * GwHostContext, a field renamed or removed, a handle method changed.
 * Additive, optional fields do not bump it.
 */
export const EMBED_CONTRACT = 1;
