/**
 * Runtime entitlement (spec-mobile-app.md "Runtime entitlement").
 *
 * Being baked into the binary does not mean being shown. After sign-in and
 * on foreground the core evaluates every baked module's `available(ctx)`
 * probe concurrently and persists the last successful result, so an
 * offline launch renders the last-known tab set instead of a false
 * "nothing enabled" state. A probe that THROWS is transient and keeps the
 * module's last-known state; only a resolved `false` is a definitive no.
 *
 * This layer is also the paid-tier seam: a tier is a set of per-member
 * module grants reflected by these probes. Purchases stay web-side.
 */

import { allModules } from './registry';
import { getModuleContext } from './context';
import { cacheGet, cacheSet } from './cache';

export type SessionGate =
  | { state: 'ready' }
  | { state: 'blocked'; moduleId: string };

const ENTITLEMENT_KEY = 'core:entitlement';

export interface EntitlementState {
  /** moduleId → enabled, last-known-good. */
  enabled: Record<string, boolean>;
  checkedAt: number;
}

export async function loadPersistedEntitlement(): Promise<EntitlementState | undefined> {
  const v = (await cacheGet(ENTITLEMENT_KEY)) as EntitlementState | undefined;
  return v && typeof v === 'object' && v.enabled ? v : undefined;
}

/**
 * Run every module's probe. Transient failures keep the module's previous
 * value (from `previous`); definitive false disables it.
 */
export async function evaluateEntitlement(
  previous: EntitlementState | undefined
): Promise<EntitlementState> {
  const ctx = getModuleContext();
  const modules = allModules();

  const results = await Promise.allSettled(modules.map((m) => m.available(ctx)));

  const enabled: Record<string, boolean> = {};
  modules.forEach((m, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') enabled[m.id] = r.value;
    else enabled[m.id] = previous?.enabled[m.id] ?? false;
  });

  const state: EntitlementState = { enabled, checkedAt: Date.now() };
  await cacheSet(ENTITLEMENT_KEY, state);
  return state;
}

/**
 * Run modules' onSessionReady hooks (e.g. health-core linking the auth
 * user to a person row). Runs before probes. The first module reporting
 * 'blocked' gates the whole app behind its blockedScreen — a hook that
 * THROWS is treated as transient and does not block (its probes will
 * simply fail closed until the next evaluation).
 */
export async function runSessionReadyHooks(): Promise<SessionGate> {
  const ctx = getModuleContext();
  for (const mod of allModules()) {
    if (!mod.onSessionReady) continue;
    try {
      const result = await mod.onSessionReady(ctx);
      if (result === 'blocked') return { state: 'blocked', moduleId: mod.id };
    } catch {
      // Transient — do not block the app on a network blip.
    }
  }
  return { state: 'ready' };
}
