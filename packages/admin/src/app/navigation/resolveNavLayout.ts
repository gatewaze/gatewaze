/**
 * Nav-layout resolver.
 *
 * Overlays a user-configurable {@link NavLayout} on top of the module-default
 * navigation tree produced by `useNavigation`. Resolution order is:
 *
 *   module defaults (baseTree)  →  org/user layout  →  reconcile  →  (render)
 *
 * The base tree is the legacy shape: a flat list of top-level sidebar items
 * plus a single settings "root" node (id `admin`) whose `childs` are the
 * Settings-dashboard items. Both the sidebar Menu and the `/admin` settings
 * dashboard consume that shape, so the resolver re-emits the SAME shape — a
 * passthrough when no layout is present, a rebuild when one is.
 *
 * The pinned Settings / Sign Out controls live in the Sidebar shell, not in
 * this tree, so they are inherently un-configurable and need no handling here.
 */

import type { NavigationTree } from "@/@types/navigation";
import type { NavHubAccent, NavLayout, NavLayoutItem } from "@gatewaze/shared/modules";
import { NAV_HUB_ID_PATTERN, NAV_HUB_LINK_PREFIX, isNavHubAccent, isSafeHubUrl } from "@gatewaze/shared";

/** The id of the settings-dashboard root node in the navigation tree. */
export const SETTINGS_ROOT_ID = "admin";

export interface ResolvedNavigation {
  /** Top-level sidebar nodes (groups + ungrouped items). */
  sidebar: NavigationTree[];
  /** Items placed on the `/admin` settings dashboard. */
  settings: NavigationTree[];
  /**
   * Pool items referenced by no layout entry. Hidden from every live surface
   * (the user's choice) — surfaced only in the layout editor for a super_admin
   * to file into a section.
   */
  unsorted: NavigationTree[];
  /**
   * Cards on each installed module hub page, keyed by hub id. Every installed
   * hub has an entry, empty when it has no cards yet. Hub cards don't take an
   * item out of the sidebar or settings.
   */
  hubs: Record<string, NavHubCard[]>;
}

/** One card on a module hub page. */
export interface NavHubCard {
  /** The layout key: a nav item key, or `link:<slug>` for a custom card. */
  key: string;
  /** Card title: the layout label, else the item's own title. */
  title: string;
  /** i18n key for the title, when the title is the item's own (untranslated) title. */
  titleKey?: string;
  icon?: string;
  /** Layout description. Module cards fall back to the module's description on the page. */
  description?: string;
  tags: string[];
  eyebrow?: string;
  accent?: NavHubAccent;
  comingSoon: boolean;
  /** Module cards: the nav item whose page the card opens. */
  node?: NavigationTree;
  /** Custom cards: absolute http(s) URL or host path. Absent on a coming-soon card. */
  url?: string;
  newTab: boolean;
}

export interface NavPool {
  /** Every `type: "item"` leaf, keyed by its stable id. */
  items: Map<string, NavigationTree>;
  /** The settings-dashboard root node (for re-emitting its container metadata). */
  settingsRoot: NavigationTree | null;
  /** Ids of items that sit at the top level of the sidebar by default. */
  sidebarDefaultIds: string[];
  /** Ids of items that sit on the settings dashboard by default. */
  settingsDefaultIds: string[];
  /** Installed hub pages: hub id → the nav item that declares the hub. */
  hubs: Map<string, NavigationTree>;
}

/** Collect every leaf item from the base tree into a keyed pool. */
export function buildPool(baseTree: NavigationTree[]): NavPool {
  const items = new Map<string, NavigationTree>();
  const sidebarDefaultIds: string[] = [];
  const settingsDefaultIds: string[] = [];
  const hubs = new Map<string, NavigationTree>();
  let settingsRoot: NavigationTree | null = null;

  const visit = (node: NavigationTree, underSettings: boolean) => {
    const inSettings = underSettings || node.id === SETTINGS_ROOT_ID;
    if (node.id === SETTINGS_ROOT_ID) settingsRoot = node;
    if (node.type === "item") {
      items.set(node.id, node);
      if (node.hub) registerHub(node, node.hub, hubs);
      (inSettings ? settingsDefaultIds : sidebarDefaultIds).push(node.id);
    }
    for (const child of node.childs ?? []) visit(child, inSettings);
  };
  for (const node of baseTree) visit(node, false);

  return { items, settingsRoot, sidebarDefaultIds, settingsDefaultIds, hubs };
}

/**
 * Record a hub-declaring item. An id the layout sanitiser would reject is
 * ignored, so the editor never offers a list whose items vanish on save. When
 * two items declare the same id the first wins.
 */
function registerHub(node: NavigationTree, hubId: string, hubs: Map<string, NavigationTree>): void {
  if (!NAV_HUB_ID_PATTERN.test(hubId)) {
    console.warn(`[nav] ignoring hub "${hubId}" on ${node.id}: hub ids must be lowercase slugs`);
    return;
  }
  const existing = hubs.get(hubId);
  if (existing) {
    console.warn(`[nav] hub "${hubId}" is declared by both ${existing.id} and ${node.id}; using ${existing.id}`);
    return;
  }
  hubs.set(hubId, node);
}

const UNTITLED_SECTION = "\u0000untitled"; // no real title can equal this

function sectionSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}

/**
 * Build the default layout from the module/core-declared placement on each
 * item: sidebar items are grouped by their `defaultSection` (items without one
 * fall into a leading untitled group rendered inline), ordered by `order`;
 * settings-dashboard items stay flat, ordered by `order`. This is what a fresh
 * install renders when no org/user layout is saved, and what the Navigation
 * editor opens on as its starting point.
 */
export function seedLayoutFromTree(baseTree: NavigationTree[]): NavLayout {
  const pool = buildPool(baseTree);

  const sections = new Map<
    string,
    { title?: string; order: number; items: { key: string; order: number }[] }
  >();

  for (const id of pool.sidebarDefaultIds) {
    const node = pool.items.get(id);
    if (!node) continue;
    const title = node.defaultSection;
    const skey = title ?? UNTITLED_SECTION;
    const order = node.order ?? 999;
    const section = sections.get(skey) ?? { title, order: Infinity, items: [] };
    section.items.push({ key: id, order });
    section.order = Math.min(section.order, order);
    sections.set(skey, section);
  }

  const sidebar = [...sections.entries()]
    .sort(([ka, a], [kb, b]) => {
      // The untitled group always leads; titled sections follow by min order.
      if (ka === UNTITLED_SECTION) return -1;
      if (kb === UNTITLED_SECTION) return 1;
      return a.order - b.order;
    })
    .map(([, section]) => ({
      id: section.title ? sectionSlug(section.title) : "main",
      ...(section.title ? { title: section.title } : {}),
      items: section.items
        .sort((x, y) => x.order - y.order)
        .map((it) => ({ key: it.key })),
    }));

  const settings = pool.settingsDefaultIds
    .map((id) => ({ id, order: pool.items.get(id)?.order ?? 999 }))
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ key: s.id }));

  return {
    version: 1,
    sidebar,
    settings,
    hidden: [],
    defaultRoute: pool.sidebarDefaultIds[0],
  };
}

/** Resolve a layout item reference to a cloned tree node with overrides applied. */
function resolveItem(
  ref: NavLayoutItem,
  pool: NavPool,
  used: Set<string>,
  hidden: Set<string>,
): NavigationTree | null {
  if (used.has(ref.key) || hidden.has(ref.key)) return null;

  // Collapsible group: a synthetic parent (not a pool item) with leaf children.
  if (ref.children && ref.children.length > 0) {
    used.add(ref.key);
    const childs = ref.children
      .map((child) => resolveItem(child, pool, used, hidden))
      .filter((n): n is NavigationTree => n !== null);
    // Drop a group whose every child dropped out (uninstalled modules).
    if (childs.length === 0) return null;
    return {
      id: ref.key,
      type: "collapse",
      path: ref.key, // synthetic — drives the accordion key, not a route
      title: ref.label ?? "Group",
      icon: ref.icon,
      childs,
    };
  }

  // Leaf: drop references whose module is no longer installed.
  const base = pool.items.get(ref.key);
  if (!base) return null;
  used.add(ref.key);

  return {
    ...base,
    ...(ref.label ? { title: ref.label } : {}),
    ...(ref.icon ? { icon: ref.icon } : {}),
  };
}

/**
 * Resolve a layout into its surfaces (sidebar, settings, hub pages). Items the layout never references
 * land in `unsorted` (kept out of the sidebar and settings until filed; a hub
 * card can still show one). Exposed for the layout editor; the
 * render path uses {@link applyNavLayout}.
 */
export function resolveNavigation(
  baseTree: NavigationTree[],
  layout: NavLayout,
): ResolvedNavigation {
  const pool = buildPool(baseTree);
  const used = new Set<string>();
  const hidden = new Set(layout.hidden ?? []);

  const sidebar: NavigationTree[] = [];
  for (const section of layout.sidebar ?? []) {
    const children = (section.items ?? [])
      .map((ref) => resolveItem(ref, pool, used, hidden))
      .filter((n): n is NavigationTree => n !== null);

    if (children.length === 0) continue;

    if (section.title) {
      sidebar.push({
        id: `section.${section.id}`,
        type: "group",
        title: section.title,
        icon: section.icon,
        childs: children,
      });
    } else {
      // Untitled section renders its items ungrouped at the top level.
      sidebar.push(...children);
    }
  }

  const settings = (layout.settings ?? [])
    .map((ref) => resolveItem(ref, pool, used, hidden))
    .filter((n): n is NavigationTree => n !== null);

  // Hub cards are independent of every other placement: they neither take an
  // item out of the sidebar nor respect "hidden". Only installed hubs resolve.
  const hubs: Record<string, NavHubCard[]> = {};
  for (const hubId of pool.hubs.keys()) {
    const filed = layout.hubs && Object.hasOwn(layout.hubs, hubId) ? layout.hubs[hubId] : [];
    const seen = new Set<string>();
    hubs[hubId] = [];
    for (const ref of filed) {
      if (seen.has(ref.key)) continue;
      const card = resolveHubCard(ref, hubId, pool);
      if (!card) continue;
      seen.add(ref.key);
      hubs[hubId].push(card);
    }
  }

  // Anything in the pool the layout neither placed nor hid.
  const unsorted: NavigationTree[] = [];
  for (const [key, node] of pool.items) {
    if (used.has(key) || hidden.has(key)) continue;
    unsorted.push(node);
  }

  return { sidebar, settings, unsorted, hubs };
}

/**
 * Resolve one hub card, or null when it can't render: its module is gone, it
 * is the hub's own page, or a custom card has no title or no safe link. The
 * layout is checked again here because it is stored data that other admins
 * read, and not every write path runs the sanitiser.
 */
function resolveHubCard(ref: NavLayoutItem, hubId: string, pool: NavPool): NavHubCard | null {
  const comingSoon = ref.comingSoon === true;
  const common = {
    key: ref.key,
    description: ref.description,
    tags: Array.isArray(ref.tags) ? ref.tags.filter((t): t is string => typeof t === "string") : [],
    eyebrow: ref.eyebrow,
    accent: isNavHubAccent(ref.accent) ? ref.accent : undefined,
    comingSoon,
  };

  if (ref.key.startsWith(NAV_HUB_LINK_PREFIX)) {
    if (!ref.label) return null;
    const url = isSafeHubUrl(ref.url) ? ref.url : undefined;
    if (!url && !comingSoon) return null;
    return { ...common, title: ref.label, icon: ref.icon, url, newTab: url !== undefined && ref.newTab === true };
  }

  const node = pool.items.get(ref.key);
  // A hub never lists its own page (nor a duplicate declarer of its id), and
  // an item with no route has nothing to open.
  if (!node || !node.path || node.hub === hubId) return null;
  return {
    ...common,
    title: ref.label ?? node.title ?? ref.key,
    ...(!ref.label && node.transKey ? { titleKey: node.transKey } : {}),
    icon: ref.icon ?? node.icon,
    node,
    newTab: false,
  };
}

/**
 * Apply a layout to the base tree, returning the legacy `[...sidebar,
 * settingsRoot]` shape that `useNavigation` consumers expect. A `null` layout
 * is a passthrough, so the sidebar renders exactly as it did before the
 * feature existed. `unsorted` items are left out of the sidebar and settings.
 */
export function applyNavLayout(
  baseTree: NavigationTree[],
  layout: NavLayout | null,
): NavigationTree[] {
  if (!layout) return baseTree;

  const { sidebar, settings } = resolveNavigation(baseTree, layout);
  const pool = buildPool(baseTree);

  const result = [...sidebar];
  if (pool.settingsRoot) {
    result.push({ ...pool.settingsRoot, childs: settings });
  }
  return result;
}
