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

/**
 * Optional features this embed build supports, stamped into the manifest
 * beside EMBED_CONTRACT. Additive features go here instead of bumping the
 * contract, because the loader requires an exact contract match and a bump
 * would make every installed loader refuse the next bundle.
 *
 * - 'host-session': GwHostContext.session (the host holds the Supabase
 *   session; signIn optional). A bundle without it would ignore `session`
 *   and silently keep a localStorage session, so the loader refuses to
 *   mount a host-session context against a manifest that lacks it.
 */
export const EMBED_CAPABILITIES: readonly string[] = ['host-session'];
