/**
 * The runtime view over the generated module registry. This file is the
 * ONLY consumer of src/generated/mobile-modules.ts; everything else asks
 * the registry, keeping the generated import surface in one place.
 */

import type {
  GatewazeMobileModule,
  MobileTabContribution,
  MobileScreenContribution,
  MobileSettingsSection,
  MobileComposerMode,
  MobileComponentThunk,
  MobileCoachProvider,
  MobileDaySummaryContribution,
} from '@gatewaze/shared';
import { mobileModules } from '../generated/mobile-modules';
import deletionCopy from '../generated/deletion-copy.json';
import { registerOutboxKind } from './outbox';
import { getModuleContext } from './context';

export function allModules(): GatewazeMobileModule[] {
  return mobileModules;
}

export function moduleById(id: string): GatewazeMobileModule | undefined {
  return mobileModules.find((m) => m.id === id);
}

export function allTabs(): Array<MobileTabContribution & { moduleId: string }> {
  return mobileModules
    .flatMap((m) => (m.tabs ?? []).map((t) => ({ ...t, moduleId: m.id })))
    .sort((a, b) => a.order - b.order);
}

/**
 * Panels for the day summary drawer, in the order they should be shown.
 *
 * Only modules the member is entitled to appear. Entitlement is not checked
 * here: the drawer renders what the tab set already proved available, the same
 * way the composer's mode track does.
 */
export function daySummaryPanels(): Array<
  MobileDaySummaryContribution & { moduleId: string }
> {
  return mobileModules
    .flatMap((m) => (m.daySummary ?? []).map((d) => ({ ...d, moduleId: m.id })))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.key.localeCompare(b.key));
}

/**
 * A module's pushable screen by name.
 *
 * Reached through `/m/<moduleId>/<view>`. The route's dynamic segment is
 * `[view]` rather than `[screen]` because React Navigation reserves `screen`
 * as a navigation param and swallows it.
 */
export function findScreen(
  moduleId: string,
  name: string
): (MobileScreenContribution & { moduleId: string }) | undefined {
  const mod = moduleById(moduleId);
  const screen = mod?.screens?.find((s) => s.name === name);
  return screen ? { ...screen, moduleId } : undefined;
}

/**
 * Drawer entries grouped into sections, in the order each section's
 * lowest-ordered entry appears. Entries without a section group under the
 * fallback label (the app name).
 */
export function drawerSections(
  enabled: Record<string, boolean>,
  fallbackLabel: string
): Array<{ title: string; entries: Array<MobileTabContribution & { moduleId: string }> }> {
  const entries = allTabs().filter((t) => enabled[t.moduleId]);
  const order: string[] = [];
  const bySection = new Map<string, Array<MobileTabContribution & { moduleId: string }>>();
  for (const entry of entries) {
    const key = entry.section ?? fallbackLabel;
    if (!bySection.has(key)) {
      bySection.set(key, []);
      order.push(key);
    }
    bySection.get(key)!.push(entry);
  }
  return order.map((title) => ({ title, entries: bySection.get(title)! }));
}

/** Composer modes from every baked module, entitlement-filtered. */
export function composerModes(
  enabled: Record<string, boolean>
): Array<MobileComposerMode & { moduleId: string }> {
  return mobileModules
    .filter((m) => enabled[m.id])
    .flatMap((m) => (m.composerModes ?? []).map((mode) => ({ ...mode, moduleId: m.id })))
    .sort((a, b) => a.order - b.order);
}

/** Renderer for a rich card kind, or undefined for the fallback card. */
export function threadCardRenderer(kind: string): MobileComponentThunk | undefined {
  for (const mod of mobileModules) {
    const renderer = mod.threadCards?.[kind];
    if (renderer) return renderer;
  }
  return undefined;
}

/**
 * The single module that owns the coach conversation, if any. The
 * generator guarantees at most one; with none, the app has no coach
 * surface and opens at the first enabled destination.
 */
export function coachProvider(): (MobileCoachProvider & { moduleId: string }) | undefined {
  const mod = mobileModules.find((m) => m.coachProvider);
  return mod ? { ...(mod.coachProvider as MobileCoachProvider), moduleId: mod.id } : undefined;
}

export function allSettingsSections(): Array<MobileSettingsSection & { moduleId: string }> {
  return mobileModules
    .flatMap((m) => (m.settingsSections ?? []).map((s) => ({ ...s, moduleId: m.id })))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** Generator-collated moduleId → deletionCopy (cannot drift from the built scope). */
export function deletionCopyByModule(): Record<string, string> {
  return deletionCopy as Record<string, string>;
}

let outboxWired = false;

/** Wire every module's outbox kind handlers into the core outbox. Idempotent. */
export function wireOutboxKinds(): void {
  if (outboxWired) return;
  outboxWired = true;
  for (const mod of mobileModules) {
    for (const [kind, handler] of Object.entries(mod.outboxKinds ?? {})) {
      registerOutboxKind(kind, (payload, clientRef) =>
        handler(getModuleContext(), payload, clientRef)
      );
    }
  }
}
