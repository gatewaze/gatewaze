import type { ComponentType } from 'react';

/**
 * Portal Module Slot Registry
 *
 * Modules register their portal UI components into named slots.
 * Since the portal is a Next.js app (no Vite virtual module), modules
 * call `registerPortalSlot()` to declare their slot contributions.
 *
 * Module packages should call this in a top-level side-effect import:
 *
 * @example
 * // In a module's portal/index.ts
 * import { registerPortalSlot } from '@gatewaze/portal/lib/modules/registry';
 *
 * registerPortalSlot({
 *   moduleId: 'event-speakers',
 *   slotName: 'event-detail:tabs',
 *   component: () => import('./SpeakersTab'),
 *   order: 20,
 * });
 */

export interface PortalSlotEntry {
  moduleId: string;
  slotName: string;
  component: () => Promise<{ default: ComponentType<any> }>;
  order?: number;
  requiredFeature?: string;
}

const slotRegistry = new Map<string, PortalSlotEntry[]>();

/**
 * Register a module component into a named portal slot.
 * Call this at module load time (top-level side effect).
 */
export function registerPortalSlot(entry: PortalSlotEntry): void {
  const existing = slotRegistry.get(entry.slotName) ?? [];
  existing.push(entry);
  existing.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  slotRegistry.set(entry.slotName, existing);
}

/**
 * Get all registered slot entries for a given slot name.
 */
export function getPortalSlots(slotName: string): PortalSlotEntry[] {
  return slotRegistry.get(slotName) ?? [];
}

/**
 * Get all registered slot names (useful for debugging).
 */
export function getRegisteredSlotNames(): string[] {
  return [...slotRegistry.keys()];
}
