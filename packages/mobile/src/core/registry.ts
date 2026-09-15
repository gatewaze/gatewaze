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
  MobilePhotoKind,
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

/**
 * The brand wordmark, contributed by whichever baked module declares one
 * (the registry takes the first). null = no module brands this build; the
 * chrome falls back to the app name as text.
 */
export function brandLogo() {
  return mobileModules.find((m) => m.brandLogo)?.brandLogo ?? null;
}

/** Where the problem-report sheet POSTs, or null to hide the bug button. */
export function feedbackPath(): string | null {
  return mobileModules.find((m) => m.feedback)?.feedback?.path ?? null;
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
 * Every photo kind the baked modules offer, in chooser order.
 *
 * Food sorts first by its `order`, because it is the one taken daily while a
 * body or medication photo is occasional.
 */
export function photoKinds(): Array<MobilePhotoKind & { moduleId: string }> {
  return mobileModules
    .flatMap((m) => (m.photoKinds ?? []).map((k) => ({ ...k, moduleId: m.id })))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
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
/**
 * The colour a module's cards are marked with in the thread.
 *
 * Cards are registered by KIND, namespaced '<moduleId>:<kind>', so the module
 * is recoverable from the kind without the card having to declare it. Returns
 * undefined for an unknown module, and the caller falls back to the core's
 * accent rather than inventing one.
 */
export function moduleColor(moduleId: string): string | undefined {
  return mobileModules.find((m) => m.id === moduleId)?.color;
}

/** The module a namespaced card kind belongs to, e.g. 'health-diet:food'. */
export function moduleOfKind(kind: string): string | undefined {
  const at = kind.indexOf(':');
  return at > 0 ? kind.slice(0, at) : undefined;
}

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

/**
 * Settings sections, for the modules that are actually on for this member.
 *
 * `enabled` is the same map the drawer is built from. Passing it is not
 * optional in practice and the parameter is only tolerant of being omitted so
 * that a caller with no entitlement loaded yet shows nothing rather than
 * everything.
 *
 * It used to take no argument and return every baked module's section. Tabs
 * were filtered and settings were not, so a module that was switched off
 * server-side still contributed a panel — which then rendered its own "could
 * not load" error, because its routes are not mounted when it is disabled. A
 * member saw a broken setting for a feature they do not have.
 */
export function allSettingsSections(
  enabled?: Record<string, boolean>
): Array<MobileSettingsSection & { moduleId: string }> {
  return mobileModules
    .filter((m) => (enabled ? enabled[m.id] === true : false))
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
