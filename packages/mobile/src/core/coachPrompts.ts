/**
 * The openers the composer cycles through while its field is empty.
 *
 * These are the coach greeting's `starters` — the same strings the empty
 * thread shows as tappable chips. They are reused rather than a list being
 * written here, for the reason the core has no list to write: it knows
 * nothing about food, training or medicines, so anything hardcoded here
 * would either be useless ("Ask me something") or would name a module the
 * build might not include.
 *
 * Held in the core rather than in CoachHome because the composer on every
 * OTHER destination needs them too, and that one never loads a greeting. It
 * would otherwise show a static placeholder while the coach's cycled, which
 * is exactly the kind of drift that having one composer was meant to end.
 *
 * Cached, so the cycle is populated on the first frame after a cold start
 * instead of waiting for the greeting request to come back.
 */

import { cacheGet, cacheSet } from './cache';

const KEY = 'core:coach-prompts';

let prompts: string[] = [];
const listeners = new Set<(p: string[]) => void>();

/** Restore the last known set. Called once, as the app starts. */
export async function loadCoachPrompts(): Promise<void> {
  const stored = await cacheGet(KEY);
  if (Array.isArray(stored) && stored.every((s) => typeof s === 'string')) {
    setCoachPrompts(stored as string[], false);
  }
}

/**
 * Publish the current openers. `persist` is false when restoring, so a
 * restore does not write back what it just read.
 */
export function setCoachPrompts(next: string[], persist = true): void {
  const clean = next.map((s) => s.trim()).filter(Boolean);
  // Same list, same order: nothing to tell anyone, and re-publishing would
  // restart every composer's cycle from the first item on each greeting
  // refresh.
  if (clean.length === prompts.length && clean.every((s, i) => s === prompts[i])) return;
  prompts = clean;
  if (persist) void cacheSet(KEY, clean);
  listeners.forEach((fn) => fn(prompts));
}

export function coachPrompts(): string[] {
  return prompts;
}

export function onCoachPromptsChange(fn: (p: string[]) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
