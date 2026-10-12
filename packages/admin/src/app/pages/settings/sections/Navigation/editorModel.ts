/**
 * Navigation editor model: converts between a saved NavLayout and the editor's
 * container state, and holds the drop rules. Kept free of React so it can be
 * unit-tested.
 */

import type { NavLayout } from "@gatewaze/shared/modules";
import type { NavigationTree } from "@/@types/navigation";
import type { NavPool } from "@/app/navigation/resolveNavLayout";

// ── Editor model ────────────────────────────────────────────────────────────
// Containers hold ordered item keys. Section containers are id'd `sec:<id>`;
// the fixed containers are `settings`, `hidden`, and `unsorted` (the source
// pool of not-yet-placed items, kept out of every live surface). Each
// installed module hub page (an item declaring `hub`) adds a `hub:<id>`
// container.

export type Containers = Record<string, string[]>;
export type Override = { label?: string; icon?: string };

export const SETTINGS = "settings";
export const HIDDEN = "hidden";
export const UNSORTED = "unsorted";
export const secId = (id: string) => `sec:${id}`;
export const hubContainerId = (id: string) => `hub:${id}`;

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
  for (const id of hubIds) containers[hubContainerId(id)] = [];
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
  for (const id of hubIds) {
    const filed = layout.hubs && Object.hasOwn(layout.hubs, id) ? layout.hubs[id] : [];
    for (const item of filed) {
      // A hub never lists its own page; leave it for the sidebar/unsorted.
      if (!canFileOntoHub(pool.items.get(item.key), id)) continue;
      if (take(item.key)) {
        containers[hubContainerId(id)].push(item.key);
        recordOverride(item.key, item.icon, item.label);
      }
    }
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
  return { containers, sectionOrder, sectionMeta, groups, sectionGroups, overrides, hubIds, defaultRoute: layout.defaultRoute };
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
    ...(state.hubIds.length > 0
      ? {
          hubs: Object.fromEntries(
            state.hubIds.map((id) => [id, (state.containers[hubContainerId(id)] ?? []).map(itemRef)]),
          ),
        }
      : {}),
    hidden: state.containers[HIDDEN] ?? [],
    // A page filed onto a hub has no sidebar entry to land on, so it can't be
    // the default page; drop it rather than save a default that silently
    // falls back to the first route.
    ...(state.defaultRoute && !isOnHub(state, state.defaultRoute) ? { defaultRoute: state.defaultRoute } : {}),
  };
}

function isOnHub(state: EditorState, key: string): boolean {
  return state.hubIds.some((id) => (state.containers[hubContainerId(id)] ?? []).includes(key));
}

/** False when `node` is a page declaring hub `hubId`: a hub never lists itself. */
export function canFileOntoHub(node: NavigationTree | undefined, hubId: string): boolean {
  return node?.hub !== hubId;
}

/** Whether the item `node` may be dropped into the container `containerId`. */
export function canDropInto(containerId: string, node: NavigationTree | undefined): boolean {
  if (!containerId.startsWith("hub:")) return true;
  return canFileOntoHub(node, containerId.slice("hub:".length));
}

export function findContainerIn(state: EditorState, key: string): string | undefined {
  if (state.containers[key]) return key;
  return Object.keys(state.containers).find((c) => state.containers[c].includes(key));
}
