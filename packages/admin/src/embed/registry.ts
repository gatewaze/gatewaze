/**
 * Module-scoped registry of live embed mounts. Exactly one live mount is
 * supported per page (v1) — concurrent outlets (split view) are
 * explicitly unsupported, and a second mount attempt (whether into the
 * same element or a different one) is refused deterministically rather
 * than silently double-mounting React into the page.
 *
 * This is process-wide state, not per-element, on purpose: two different
 * elements mounting concurrently must be refused the same way a second
 * mount into the same element is.
 */

let liveMountElement: HTMLElement | null = null;

export interface RegisterResult {
  ok: boolean;
}

/** Registers `el` as the live mount. Returns { ok: false } if one is already live. */
export function tryRegisterMount(el: HTMLElement): RegisterResult {
  if (liveMountElement) {
    return { ok: false };
  }
  liveMountElement = el;
  return { ok: true };
}

/**
 * Deregisters the live mount. Safe to call multiple times, and safe to
 * call for an element that never successfully registered (no-op) — this
 * is what lets a failed mount's `finally` block unconditionally
 * deregister without needing to track whether registration happened.
 */
export function deregisterMount(el: HTMLElement): void {
  if (liveMountElement === el) {
    liveMountElement = null;
  }
}

export function isMountLive(): boolean {
  return liveMountElement !== null;
}

/** Test-only escape hatch — vitest specs run in the same module registry across cases. */
export function _resetRegistryForTests(): void {
  liveMountElement = null;
}
