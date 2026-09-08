import { createRoot, type Root } from 'react-dom/client';
import { StrictMode } from 'react';

import { configureEmbedSupabase } from '@/lib/supabase';

import { getCompiledFeatures, getCompiledModuleIds } from './embed/compiledModules';
import { EmbedApp } from './embed/EmbedApp';
import { deregisterMount, tryRegisterMount } from './embed/registry';
import { sanitizeMessage } from './embed/sanitize';
import { createTelemetry } from './embed/telemetry';
import { validateGwHostContext } from './embed/validateContext';
import type { GwEmbedFatalError, GwHostContext } from './embed/types';

export type { GwHostContext, GwEmbedFatalError, GwEmbedFatalErrorType, GwEmbedHandle } from './embed/types';

/**
 * Embed build version — bump alongside packages/admin/package.json's
 * `version` field on release. The host logs this at mount so a support
 * ticket can pin down exactly which embed build is live.
 */
export const version = '0.1.0-pilot';

const NOOP_HANDLE = { unmount() {} };

/**
 * Unrecognized entries in ctx.enabled are ignored, never fatal — the host
 * passes through module/feature ids from GW's own registry, and a
 * mismatch (stale host config, a module not compiled into this build)
 * should just mean "that gate never opens," not a broken mount.
 */
function warnOnUnknownEnablement(ctx: GwHostContext): void {
  const compiledModuleIds = new Set(getCompiledModuleIds());
  const compiledFeatures = new Set(getCompiledFeatures());

  for (const id of ctx.enabled.moduleIds) {
    if (!compiledModuleIds.has(id)) {
      console.warn(`[gw-embed] enabled.moduleIds contains "${id}", which is not compiled into this embed build — ignored`);
    }
  }
  for (const feature of ctx.enabled.features) {
    if (!compiledFeatures.has(feature)) {
      console.warn(`[gw-embed] enabled.features contains "${feature}", which no compiled module declares — ignored`);
    }
  }
}

function reportFatal(ctx: Pick<GwHostContext, 'onFatal'> | undefined, error: GwEmbedFatalError) {
  console.warn(`[gw-embed] ${error.code}: ${error.message}`);
  ctx?.onFatal?.(error);
}

/**
 * Mount the Gatewaze admin module set into `el`. Validates `ctx` first,
 * enforces the one-live-mount-per-page contract, then boots the React
 * tree (error boundary -> provider stack -> router). See src/embed/*.tsx
 * for the pieces; this file just wires them together and owns the
 * mount/unmount lifecycle contract described in GwHostContext's doc
 * comments (spec: "Gatewaze admin modules embedded in LFX One").
 *
 * Never throws — every failure path reports through onFatal (and
 * console.warn as a floor) and returns a safe handle instead.
 */
export function mount(el: HTMLElement, ctx: GwHostContext): { unmount(): void } {
  const validation = validateGwHostContext(ctx);
  if (!validation.ok) {
    reportFatal(ctx, validation.error);
    return NOOP_HANDLE;
  }
  const validCtx = validation.ctx;

  const registration = tryRegisterMount(el);
  if (!registration.ok) {
    reportFatal(validCtx, {
      error_type: 'mount_aborted',
      code: 'gw_double_mount',
      message: 'A Gatewaze embed is already mounted on this page; only one live mount is supported.',
      recoverable: false,
    });
    return NOOP_HANDLE;
  }

  let root: Root | null = null;
  try {
    // Set the runtime-config global before anything else touches a
    // config-reading singleton (supabase.ts, the vite-plugin-gatewaze-
    // modules build-time `define` rewrite reads this same global at
    // runtime for every VITE_* reference discovered in source).
    (globalThis as Record<string, unknown>).__GATEWAZE_CONFIG__ = {
      VITE_SUPABASE_URL: validCtx.supabase.url,
      VITE_SUPABASE_ANON_KEY: validCtx.supabase.anonKey,
      VITE_API_URL: validCtx.apiBaseUrl === '' ? '/api/gw' : validCtx.apiBaseUrl,
    };

    configureEmbedSupabase({
      url: validCtx.supabase.url,
      anonKey: validCtx.supabase.anonKey,
      storageKeySuffix: validCtx.storageKeySuffix,
    });

    warnOnUnknownEnablement(validCtx);

    const telemetry = createTelemetry(validCtx.telemetry);
    telemetry('gw_embed_mount', { version });

    root = createRoot(el);
    root.render(
      <StrictMode>
        <EmbedApp ctx={validCtx} container={el} />
      </StrictMode>,
    );

    const handle = {
      unmount() {
        root?.unmount();
        deregisterMount(el);
      },
    };
    return handle;
  } catch (err) {
    // Self-heal: a partial failure here must not poison the next mount
    // attempt into the same or a different element.
    deregisterMount(el);
    reportFatal(validCtx, {
      error_type: root ? 'render_crash' : 'import_failed',
      code: 'gw_mount_failed',
      message: sanitizeMessage(err),
      recoverable: false,
    });
    return NOOP_HANDLE;
  }
}
