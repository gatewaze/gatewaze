/**
 * Public contract for @gatewaze/admin-embed, the embeddable admin
 * library. The host application's outlet component is the only intended
 * caller of mount()/unmount(); this file has no dependency on any host
 * framework.
 */

export interface GwHostContext {
  /**
   * Leading '/', no trailing slash, URL-path-safe segments only, and
   * must equal the host route prefix exactly (e.g. '/apps/gw').
   */
  basename: string;
  supabase: { url: string; anonKey: string };
  /**
   * '' or a same-origin absolute path (leading '/', no scheme/host, no
   * trailing slash); '' means /api/gw. Cross-origin values are rejected —
   * the token-containment guarantee (the Supabase access token never
   * rides to a third-party origin) depends on this always resolving
   * same-origin.
   */
  apiBaseUrl: string;
  /**
   * Host overlay. Runtime-gates even compiled-in modules on top of
   * whatever GW's own installed_modules/RLS state allows — it narrows,
   * it never widens. ids/feature strings come from GW's existing module
   * registry (the same names useModuleSlots consumes); the host passes
   * them through, it does not invent keys.
   */
  enabled: { moduleIds: string[]; features: string[] };
  signIn: { lfidStartUrl: string; returnUrl: string };
  /** Session isolation; embed defaults to 'host_embed' if omitted. */
  storageKeySuffix?: string;
  /**
   * Where Radix portals render. Host-owned; must outlive the mount, and
   * only the embed (and unmount) writes into it.
   */
  portalContainer?: HTMLElement;
  /** Host hook: embed gave up. */
  onFatal?: (err: GwEmbedFatalError) => void;
  /**
   * SPA navigation to host routes OUTSIDE the prefix (basename-relative
   * useNavigate can't leave it). Fallback when absent: full
   * window.location assign.
   */
  navigateHost?: (path: string) => void;
  /**
   * Host telemetry sink; console.warn fallback if absent. The embed
   * never imports a host logging singleton.
   */
  telemetry?: (event: { name: string; [key: string]: unknown }) => void;
}

export type GwEmbedFatalErrorType =
  | 'config_invalid'
  | 'import_failed'
  | 'mount_aborted'
  | 'render_crash';

export interface GwEmbedFatalError {
  error_type: GwEmbedFatalErrorType;
  /** e.g. 'gw_double_mount', 'gw_ctx_basename_invalid'. */
  code: string;
  /** Sanitized — never includes tokens, URLs with query/fragment, or stack traces. */
  message: string;
  field?: string;
  recoverable: boolean;
}

export interface GwEmbedHandle {
  unmount(): void;
}
