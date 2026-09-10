/**
 * The MobileModuleContext handed to module code — core primitives only,
 * so the core never knows any module's client types.
 */

import type { MobileModuleContext } from '@gatewaze/shared';
import { apiFetch } from './http';
import { cacheGet, cacheSet } from './cache';
import { enqueue } from './outbox';

const memoryStore = new Map<string, unknown>();

let ctx: MobileModuleContext | null = null;

export function getModuleContext(): MobileModuleContext {
  if (!ctx) {
    ctx = {
      apiFetch,
      cacheGet: (key) => cacheGet(key),
      cacheSet,
      enqueue,
      store: {
        get: (key) => memoryStore.get(key),
        set: (key, value) => {
          memoryStore.set(key, value);
        },
      },
    };
  }
  return ctx;
}

/** Cleared on sign-out — the store is session-scoped. */
export function clearModuleStore(): void {
  memoryStore.clear();
}
