/**
 * Navigation editor model: converts between a saved NavLayout and the editor's
 * state, and holds the hub card rules. Kept free of React so it can be
 * unit-tested.
 */

import { NAV_HUB_LINK_PREFIX, isSafeHubUrl } from "@gatewaze/shared";
import type { NavLayout, NavLayoutItem } from "@gatewaze/shared/modules";
import type { NavigationTree } from "@/@types/navigation";
import type { NavPool } from "@/app/navigation/resolveNavLayout";

// ── Editor model ────────────────────────────────────────────────────────────
// Containers hold ordered item keys. Section containers are id'd `sec:<id>`;
// the fixed containers are `settings`, `hidden`, and `unsorted` (the source
// pool of not-yet-placed items, kept out of the sidebar). Every pool item is
// in exactly one container.
//
// Hub cards live apart from the containers, in `hubCards`, because they are
// independent of them: a page can be in the sidebar and on a hub at once, and
// a hub can also hold custom link cards that aren't pool items at all.

export type Containers = Record<string, string[]>;
export type Override = { label?: string; icon?: string };

export const SETTINGS = "settings";
export const HIDDEN = "hidden";
export const UNSORTED = "unsorted";
export const secId = (id: string) => `sec:${id}`;

// A collapsible group is a container whose id IS its synthetic `group:*` key
// (already unique + namespaced; no pool item ever collides). It belongs to a
// section and holds leaf keys.

export interface EditorState {
  containers: Containers;
  sectionOrder: string[]; // section ids (without the sec: prefix)
  sectionMeta: Record<string, { title?: string; icon?: string }>;
  groups: Record<string, { label?: string; icon?: string }>;
  sectionGroups: Record<string, string[]>; // section id -> ordered group keys
  overrides: Record<string, Override>;
  hubIds: string[]; // installed hub ids, in pool order
  hubCards: Record<string, NavLayoutItem[]>; // hub id -> its cards, in order
  /**
   * Card lists for hubs whose module isn't installed or enabled right now.
   * Not editable, but written back on save so disabling a module for a while
   * doesn't delete its cards (custom cards can't be rebuilt from defaults).
   */
  otherHubs: Record<string, NavLayoutItem[]>;
  defaultRoute?: string;
}

/** Every pool item key, sidebar defaults first. */
export function poolKeysOf(pool: NavPool): string[] {
  return [...pool.sidebarDefaultIds, ...pool.settingsDefaultIds];
}

export function layoutToState(layout: NavLayout, pool: NavPool): EditorState {
  const poolKeys = poolKeysOf(pool);
  const inPool = new Set(poolKeys);
  const containers: Containers = { [SETTINGS]: [], [HIDDEN]: [], [UNSORTED]: [] };
  const hubIds = [...pool.hubs.keys()];
  const sectionOrder: string[] = [];
  const sectionMeta: EditorState["sectionMeta"] = {};
  const groups: EditorState["groups"] = {};
  const sectionGroups: EditorState["sectionGroups"] = {};
  const overrides: Record<string, Override> = {};
  const placed = new Set<string>();

  const take = (key: string) => {
    if (!inPool.has(key) || placed.has(key)) return false;
    placed.add(key);
    return true;
  };
  const recordOverride = (key: string, icon?: string, label?: string) => {
    if (icon || label) overrides[key] = { ...(icon && { icon }), ...(label && { label }) };
  };

  for (const section of layout.sidebar) {
    const id = section.id;
    sectionOrder.push(id);
    sectionMeta[id] = { title: section.title, icon: section.icon };
    containers[secId(id)] = [];
    sectionGroups[id] = [];
    for (const item of section.items) {
      if (item.children && item.children.length > 0) {
        // A collapsible group entry.
        const gkey = item.key;
        groups[gkey] = { label: item.label, icon: item.icon };
        sectionGroups[id].push(gkey);
        containers[gkey] = [];
        for (const child of item.children) {
          if (take(child.key)) {
            containers[gkey].push(child.key);
            recordOverride(child.key, child.icon, child.label);
          }
        }
      } else if (take(item.key)) {
        containers[secId(id)].push(item.key);
        recordOverride(item.key, item.icon, item.label);
      }
    }
  }
  for (const item of layout.settings) {
    if (take(item.key)) {
      containers[SETTINGS].push(item.key);
      recordOverride(item.key, item.icon, item.label);
    }
  }
  const hubCards: EditorState["hubCards"] = {};
  for (const id of hubIds) {
    const filed = layout.hubs && Object.hasOwn(layout.hubs, id) ? layout.hubs[id] : [];
    const seen = new Set<string>();
    hubCards[id] = filed.filter((card) => {
      if (seen.has(card.key)) return false;
      // A hub never lists its own page. Everything else is kept, including
      // cards whose module is disabled for now: they don't render, but saving
      // must not delete them. The editor marks them as unavailable.
      const keep = isCustomCard(card) || canFileOntoHub(pool.items.get(card.key), id);
      if (keep) seen.add(card.key);
      return keep;
    });
  }
  const otherHubs: EditorState["otherHubs"] = {};
  for (const [id, cards] of Object.entries(layout.hubs ?? {})) {
    if (!hubIds.includes(id)) otherHubs[id] = cards;
  }
  for (const key of layout.hidden) {
    if (take(key)) containers[HIDDEN].push(key);
  }
  // Anything in the pool the layout never referenced → Unsorted source bucket.
  for (const key of poolKeys) {
    if (!placed.has(key)) containers[UNSORTED].push(key);
  }
  if (sectionOrder.length === 0) {
    sectionOrder.push("main");
    sectionMeta.main = {};
    containers[secId("main")] = [];
    sectionGroups.main = [];
  }
  return {
    containers,
    sectionOrder,
    sectionMeta,
    groups,
    sectionGroups,
    overrides,
    hubIds,
    hubCards,
    otherHubs,
    defaultRoute: layout.defaultRoute,
  };
}

export function stateToLayout(state: EditorState): NavLayout {
  const itemRef = (key: string) => ({ key, ...state.overrides[key] });
  const groupRef = (gkey: string) => ({
    key: gkey,
    ...(state.groups[gkey]?.label ? { label: state.groups[gkey].label } : {}),
    ...(state.groups[gkey]?.icon ? { icon: state.groups[gkey].icon } : {}),
    children: (state.containers[gkey] ?? []).map(itemRef),
  });
  return {
    version: 1,
    sidebar: state.sectionOrder.map((id) => ({
      id,
      ...(state.sectionMeta[id]?.title ? { title: state.sectionMeta[id].title } : {}),
      ...(state.sectionMeta[id]?.icon ? { icon: state.sectionMeta[id].icon } : {}),
      items: [
        ...(state.containers[secId(id)] ?? []).map(itemRef),
        // Groups with no remaining children are dropped on save.
        ...(state.sectionGroups[id] ?? [])
          .filter((gkey) => (state.containers[gkey] ?? []).length > 0)
          .map(groupRef),
      ],
    })),
    settings: (state.containers[SETTINGS] ?? []).map(itemRef),
    ...(state.hubIds.length > 0 || Object.keys(state.otherHubs).length > 0
      ? {
          hubs: {
            ...state.otherHubs,
            ...Object.fromEntries(state.hubIds.map((id) => [id, state.hubCards[id] ?? []])),
          },
        }
      : {}),
    hidden: state.containers[HIDDEN] ?? [],
    // A default page that isn't in the sidebar or settings (e.g. one that is
    // only on a hub) has nowhere to land after login; drop it rather than save
    // a default that silently falls back to the first route.
    ...(state.defaultRoute && !isOffSidebar(state, state.defaultRoute) ? { defaultRoute: state.defaultRoute } : {}),
  };
}

function isOffSidebar(state: EditorState, key: string): boolean {
  return (state.containers[UNSORTED] ?? []).includes(key) || (state.containers[HIDDEN] ?? []).includes(key);
}

// ── Hub cards ────────────────────────────────────────────────────────────────

/** Longest tag the layout sanitiser keeps whole. */
const MAX_TAG_LENGTH = 40;

/** Whether a hub card is a custom link card rather than a nav item's page. */
export function isCustomCard(card: Pick<NavLayoutItem, "key">): boolean {
  return card.key.startsWith(NAV_HUB_LINK_PREFIX);
}

/** Pool items that can still be added to hub `hubId`, given its current cards. */
export function addableItems(pool: NavPool, hubId: string, cards: NavLayoutItem[]): NavigationTree[] {
  const onHub = new Set(cards.map((c) => c.key));
  return poolKeysOf(pool)
    .map((key) => pool.items.get(key))
    .filter((node): node is NavigationTree => !!node && !onHub.has(node.id) && canFileOntoHub(node, hubId));
}

/**
 * A new, unused custom card key derived from the title: `link:` plus a slug,
 * with a numeric suffix when the slug is taken.
 */
export function newLinkKey(title: string, cards: NavLayoutItem[]): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "card";
  const taken = new Set(cards.map((c) => c.key));
  let key = `${NAV_HUB_LINK_PREFIX}${base}`;
  for (let n = 2; taken.has(key); n++) key = `${NAV_HUB_LINK_PREFIX}${base}-${n}`;
  return key;
}

/**
 * Why a card can't be saved, or null when it can. Mirrors what the layout
 * sanitiser would drop, so the editor never shows a card that vanishes on save.
 */
export function hubCardError(card: NavLayoutItem): string | null {
  if ((card.tags ?? []).some((t) => t.length > MAX_TAG_LENGTH)) {
    return `Keep each tag to ${MAX_TAG_LENGTH} characters.`;
  }
  if (!isCustomCard(card)) return null;
  if (!card.label?.trim()) return "Give the card a title.";
  if (card.url) {
    if (!isSafeHubUrl(card.url)) {
      return "Use a full https:// (or http://) address, or a path that starts with a single /.";
    }
    return null;
  }
  return card.comingSoon ? null : "Add a link, or mark the card as coming soon.";
}

/** Copy of `state` with hub `hubId`'s cards replaced. */
export function withHubCards(state: EditorState, hubId: string, cards: NavLayoutItem[]): EditorState {
  return { ...state, hubCards: { ...state.hubCards, [hubId]: cards } };
}

/**
 * Drop empty optional fields from a card the editor built, so saved layouts
 * hold only what was set.
 */
export function compactCard(card: NavLayoutItem): NavLayoutItem {
  const out: NavLayoutItem = { key: card.key };
  const text = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const label = text(card.label);
  const icon = text(card.icon);
  const description = text(card.description);
  const eyebrow = text(card.eyebrow);
  const tags = (card.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (label) out.label = label;
  if (icon) out.icon = icon;
  if (description) out.description = description;
  if (eyebrow) out.eyebrow = eyebrow;
  if (tags.length > 0) out.tags = [...new Set(tags)];
  if (card.accent) out.accent = card.accent;
  if (card.comingSoon) out.comingSoon = true;
  if (isCustomCard(card)) {
    const url = text(card.url);
    if (url) out.url = url;
    if (url && card.newTab) out.newTab = true;
  }
  return out;
}

/** False when `node` is a page declaring hub `hubId`: a hub never lists itself. */
export function canFileOntoHub(node: NavigationTree | undefined, hubId: string): boolean {
  return node?.hub !== hubId;
}

export function findContainerIn(state: EditorState, key: string): string | undefined {
  if (state.containers[key]) return key;
  return Object.keys(state.containers).find((c) => state.containers[c].includes(key));
}
