/**
 * Embed-only stand-in for `sonner` that routes `toast()` to the host's own notification system.
 *
 * Why
 * ---
 * Inside a host, a second toast stack is wrong twice over: it looks like a different product, and
 * it stacks in a different corner from the host's own notifications. LFX renders toasts through
 * PrimeNG's MessageService and a single app-level `<p-toast/>`, so embed toasts should go there.
 *
 * Why an alias rather than editing call sites
 * -------------------------------------------
 * `toast` is imported straight from `sonner` at ~250 call sites across the module repos, all of
 * which the standalone admin also ships. Aliasing the bare specifier in vite.embed.config.ts keeps
 * this entirely inside the embed build — the core Gatewaze repo is untouched and its own toasts
 * keep working exactly as before. Same approach as radixThemesPortal.tsx.
 *
 * `gw-sonner-real` is a private specifier aliased to sonner's resolved entry in
 * vite.embed.config.ts. It exists because sonner's "exports" map has no catch-all, so unlike Radix
 * this package cannot be imported by path — and importing `sonner` here would resolve straight back
 * to this file.
 */
import { toast as sonnerToast } from 'gw-sonner-real';

import { getHostNotify } from './hostNotify';
import type { GwEmbedNotificationLevel } from './types';

export * from 'gw-sonner-real';

type SonnerContent = Parameters<typeof sonnerToast>[0];
type SonnerOptions = Parameters<typeof sonnerToast>[1];

let nextId = 0;

/**
 * Forward one notification, or return false if it cannot be represented.
 *
 * Only string content can cross the boundary: the host renders with its own components, so a React
 * node has no meaning there. Every call in the pilot modules passes a string or a template literal;
 * anything else falls back to sonner below rather than being silently flattened to "[object
 * Object]".
 */
function forward(level: GwEmbedNotificationLevel, content: SonnerContent, options?: SonnerOptions): string | number | false {
  const sink = getHostNotify();
  if (!sink || typeof content !== 'string') return false;

  const id = options?.id ?? `gw-embed-toast-${(nextId += 1)}`;
  sink({
    level,
    message: content,
    description: typeof options?.description === 'string' ? options.description : undefined,
    id: String(id),
    durationMs: typeof options?.duration === 'number' ? options.duration : undefined,
  });
  return id;
}

/**
 * `toast` keeps sonner's shape — callable, with the level helpers hung off it — so no call site can
 * tell the difference. Anything the host cannot render (React content, or no host sink at all)
 * falls through to the real sonner, which is why EmbedApp still mounts a Toaster.
 */
function hostToast(content: SonnerContent, options?: SonnerOptions) {
  return forward('info', content, options) || sonnerToast(content, options);
}

const LEVELS = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
  message: 'info',
  // A loading toast is a promise of a later result. The host has no in-place replacement, so it is
  // forwarded as an ordinary short-lived notice and the success/error that follows arrives as its
  // own — one extra toast rather than one that mutates.
  loading: 'info',
} as const satisfies Record<string, GwEmbedNotificationLevel>;

for (const [method, level] of Object.entries(LEVELS)) {
  (hostToast as unknown as Record<string, unknown>)[method] = (content: SonnerContent, options?: SonnerOptions) =>
    forward(level, content, options) || (sonnerToast as unknown as Record<string, (c: SonnerContent, o?: SonnerOptions) => unknown>)[method](content, options);
}

/*
 * Pass-through for the rest of sonner's surface. `custom` takes a render function and `promise`
 * resolves its messages asynchronously; neither maps onto a fire-and-forget host sink, and neither
 * is used by the pilot modules, so both keep sonner's own behaviour rather than a lossy
 * approximation. `dismiss` follows them so an id from either can still be dismissed.
 */
for (const method of ['custom', 'promise', 'dismiss', 'getHistory', 'getToasts'] as const) {
  const original = (sonnerToast as unknown as Record<string, unknown>)[method];
  if (typeof original === 'function') {
    (hostToast as unknown as Record<string, unknown>)[method] = (original as (...a: unknown[]) => unknown).bind(sonnerToast);
  }
}

export const toast = hostToast as unknown as typeof sonnerToast;
