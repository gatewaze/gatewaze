import { useEffect, useMemo, useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";

import { Page } from "@/components/shared/Page";
import { WorkspaceLayout } from "@/components/ui";
import type { Tab } from "@/components/ui/Tabs";
import { useBaseNavigation } from "@/hooks/useNavigation";
import { useFeaturePermissions } from "@/hooks/useFeaturePermissions";
import { buildPool, seedLayoutFromTree } from "@/app/navigation/resolveNavLayout";
import { navigationIcons } from "@/app/navigation/icons";
import { navLayoutService } from "@/utils/navLayoutService";
import { IconPicker } from "./IconPicker";
import type { NavLayout } from "@gatewaze/shared/modules";
import type { NavigationTree } from "@/@types/navigation";

// ── Editor model ────────────────────────────────────────────────────────────
// Containers hold ordered item keys. Section containers are id'd `sec:<id>`;
// the fixed containers are `settings`, `hidden`, and `unsorted` (the source
// pool of not-yet-placed items, kept out of every live surface).

type Scope = "org" | "me";
type Containers = Record<string, string[]>;
type Override = { label?: string; icon?: string };

const SETTINGS = "settings";
const HIDDEN = "hidden";
const UNSORTED = "unsorted";
const secId = (id: string) => `sec:${id}`;

// A collapsible group is a container whose id IS its synthetic `group:*` key
// (already unique + namespaced; no pool item ever collides). It belongs to a
// section and holds leaf keys.

interface EditorState {
  containers: Containers;
  sectionOrder: string[]; // section ids (without the sec: prefix)
  sectionMeta: Record<string, { title?: string; icon?: string }>;
  groups: Record<string, { label?: string; icon?: string }>;
  sectionGroups: Record<string, string[]>; // section id -> ordered group keys
  overrides: Record<string, Override>;
  defaultRoute?: string;
}

function layoutToState(layout: NavLayout, poolKeys: string[]): EditorState {
  const inPool = new Set(poolKeys);
  const containers: Containers = { [SETTINGS]: [], [HIDDEN]: [], [UNSORTED]: [] };
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
  return { containers, sectionOrder, sectionMeta, groups, sectionGroups, overrides, defaultRoute: layout.defaultRoute };
}

function stateToLayout(state: EditorState): NavLayout {
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
    hidden: state.containers[HIDDEN] ?? [],
    ...(state.defaultRoute ? { defaultRoute: state.defaultRoute } : {}),
  };
}

// ── Presentational ──────────────────────────────────────────────────────────

function ItemRow({
  itemKey,
  node,
  override,
  onEdit,
}: {
  itemKey: string;
  node: NavigationTree | undefined;
  override?: Override;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: itemKey });
  const iconName = override?.icon ?? node?.icon;
  const Icon = iconName ? navigationIcons[iconName] : undefined;
  const label = override?.label ?? node?.title ?? itemKey;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        "flex items-center gap-2 rounded-md border border-[var(--gray-a5)] bg-[var(--color-panel-solid)] px-2 py-1.5 text-sm",
        isDragging && "opacity-50",
      )}
    >
      <button
        type="button"
        className="cursor-grab text-[var(--gray-9)] hover:text-[var(--gray-11)]"
        aria-label="Drag"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      {Icon && <Icon className="size-4 shrink-0 text-[var(--gray-11)]" />}
      <span className="min-w-0 flex-1 truncate text-[var(--gray-12)]">{label}</span>
      {(override?.label || override?.icon) && (
        <span className="rounded bg-[var(--accent-a3)] px-1 text-[10px] text-[var(--accent-11)]">
          custom
        </span>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="text-xs text-[var(--gray-10)] hover:text-[var(--accent-11)]"
      >
        Edit
      </button>
    </div>
  );
}

function Container({
  id,
  keys,
  children,
}: {
  id: string;
  keys: string[];
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext id={id} items={keys} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={clsx(
          "min-h-[44px] space-y-1.5 rounded-md p-1.5 transition-colors",
          isOver ? "bg-[var(--accent-a3)]" : "bg-[var(--gray-a2)]",
        )}
      >
        {children}
        {keys.length === 0 && (
          <p className="px-1 py-1 text-xs text-[var(--gray-9)]">Drop items here</p>
        )}
      </div>
    </SortableContext>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NavigationSettings() {
  const baseTree = useBaseNavigation();
  const { isSuperAdmin } = useFeaturePermissions();

  const pool = useMemo(() => buildPool(baseTree), [baseTree]);
  const poolKeys = useMemo(
    () => [...pool.sidebarDefaultIds, ...pool.settingsDefaultIds],
    [pool],
  );

  const [scope, setScope] = useState<Scope>("me");
  const [state, setState] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const load = useCallback(
    async (which: Scope) => {
      setLoading(true);
      setMessage(null);
      try {
        let layout: NavLayout;
        if (which === "org") {
          layout = (await navLayoutService.getOrgLayout()) ?? seedLayoutFromTree(baseTree);
        } else {
          // The personal tab edits the user's override. When they have none,
          // fall back to the org default (then module defaults) so the editor
          // shows what they currently see — and so a Reset visibly reverts to
          // the org layout rather than to a blank canvas.
          const [mine, org] = await Promise.all([
            navLayoutService.getMyLayout(),
            navLayoutService.getOrgLayout(),
          ]);
          layout = mine ?? org ?? seedLayoutFromTree(baseTree);
        }
        setState(layoutToState(layout, poolKeys));
      } catch (err) {
        setMessage({ kind: "err", text: err instanceof Error ? err.message : "Failed to load" });
        setState(layoutToState(seedLayoutFromTree(baseTree), poolKeys));
      } finally {
        setLoading(false);
      }
    },
    [baseTree, poolKeys],
  );

  useEffect(() => {
    void load(scope);
  }, [scope, load]);

  const onDragStart = (e: DragStartEvent) => setActiveKey(String(e.active.id));

  const onDragOver = (e: DragOverEvent) => {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    setState((prev) => {
      if (!prev) return prev;
      const from = prev.containers[activeId] ? activeId : findContainerIn(prev, activeId);
      const to = prev.containers[overId] ? overId : findContainerIn(prev, overId);
      if (!from || !to || from === to) return prev;
      const next = { ...prev, containers: { ...prev.containers } };
      next.containers[from] = next.containers[from].filter((k) => k !== activeId);
      const overItems = [...next.containers[to]];
      const overIdx = overItems.indexOf(overId);
      overItems.splice(overIdx >= 0 ? overIdx : overItems.length, 0, activeId);
      next.containers[to] = overItems;
      return next;
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveKey(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    setState((prev) => {
      if (!prev) return prev;
      const from = findContainerIn(prev, activeId);
      const to = prev.containers[overId] ? overId : findContainerIn(prev, overId);
      if (!from || !to) return prev;
      const next = { ...prev, containers: { ...prev.containers } };
      if (from === to) {
        const items = [...next.containers[from]];
        const oldIdx = items.indexOf(activeId);
        const newIdx = items.indexOf(overId);
        if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) {
          next.containers[from] = arrayMove(items, oldIdx, newIdx);
        }
      }
      return next;
    });
  };

  const mutate = (fn: (s: EditorState) => EditorState) =>
    setState((prev) => (prev ? fn(prev) : prev));

  const uid = () => Math.random().toString(36).slice(2, 9);

  const addSection = () =>
    mutate((s) => {
      const id = `section-${uid()}`;
      return {
        ...s,
        sectionOrder: [...s.sectionOrder, id],
        sectionMeta: { ...s.sectionMeta, [id]: { title: "New section" } },
        containers: { ...s.containers, [secId(id)]: [] },
        sectionGroups: { ...s.sectionGroups, [id]: [] },
      };
    });

  const renameSection = (id: string, title: string) =>
    mutate((s) => ({ ...s, sectionMeta: { ...s.sectionMeta, [id]: { ...s.sectionMeta[id], title } } }));

  const deleteSection = (id: string) =>
    mutate((s) => {
      const groupKeys = s.sectionGroups[id] ?? [];
      const moved = [
        ...(s.containers[secId(id)] ?? []),
        ...groupKeys.flatMap((g) => s.containers[g] ?? []),
      ];
      const containers: Containers = { ...s.containers, [UNSORTED]: [...s.containers[UNSORTED], ...moved] };
      delete containers[secId(id)];
      for (const g of groupKeys) delete containers[g];
      return {
        ...s,
        containers,
        sectionOrder: s.sectionOrder.filter((x) => x !== id),
        sectionMeta: Object.fromEntries(Object.entries(s.sectionMeta).filter(([k]) => k !== id)),
        sectionGroups: Object.fromEntries(Object.entries(s.sectionGroups).filter(([k]) => k !== id)),
        groups: Object.fromEntries(Object.entries(s.groups).filter(([k]) => !groupKeys.includes(k))),
      };
    });

  const moveSection = (id: string, dir: -1 | 1) =>
    mutate((s) => {
      const idx = s.sectionOrder.indexOf(id);
      const target = idx + dir;
      if (target < 0 || target >= s.sectionOrder.length) return s;
      return { ...s, sectionOrder: arrayMove(s.sectionOrder, idx, target) };
    });

  // ── Collapsible group operations ─────────────────────────────────────────
  const addGroup = (sectionId: string) =>
    mutate((s) => {
      const gkey = `group:${uid()}`;
      return {
        ...s,
        groups: { ...s.groups, [gkey]: { label: "New group" } },
        sectionGroups: { ...s.sectionGroups, [sectionId]: [...(s.sectionGroups[sectionId] ?? []), gkey] },
        containers: { ...s.containers, [gkey]: [] },
      };
    });

  const renameGroup = (gkey: string, label: string) =>
    mutate((s) => ({ ...s, groups: { ...s.groups, [gkey]: { ...s.groups[gkey], label } } }));

  const setGroupIcon = (gkey: string, icon: string | undefined) =>
    mutate((s) => ({ ...s, groups: { ...s.groups, [gkey]: { ...s.groups[gkey], icon } } }));

  const deleteGroup = (sectionId: string, gkey: string) =>
    mutate((s) => {
      const moved = s.containers[gkey] ?? [];
      const containers: Containers = { ...s.containers, [UNSORTED]: [...s.containers[UNSORTED], ...moved] };
      delete containers[gkey];
      return {
        ...s,
        containers,
        sectionGroups: { ...s.sectionGroups, [sectionId]: (s.sectionGroups[sectionId] ?? []).filter((g) => g !== gkey) },
        groups: Object.fromEntries(Object.entries(s.groups).filter(([k]) => k !== gkey)),
      };
    });

  const setOverride = (key: string, ov: Override) =>
    mutate((s) => {
      const overrides = { ...s.overrides };
      if (!ov.label && !ov.icon) delete overrides[key];
      else overrides[key] = ov;
      return { ...s, overrides };
    });

  const onSave = async () => {
    if (!state) return;
    setSaving(true);
    setMessage(null);
    try {
      const layout = stateToLayout(state);
      if (scope === "org") await navLayoutService.saveOrgLayout(layout);
      else await navLayoutService.saveMyLayout(layout);
      setMessage({ kind: "ok", text: "Saved. Reload to see the sidebar update." });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const onReset = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (scope === "org") await navLayoutService.saveOrgLayout(null);
      else await navLayoutService.saveMyLayout(null);
      await load(scope);
      setMessage({
        kind: "ok",
        text:
          scope === "org"
            ? "Organization layout reset to the module defaults."
            : "Your layout now follows the organization default.",
      });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Failed to reset" });
    } finally {
      setSaving(false);
    }
  };

  const sidebarRouteOptions = useMemo(() => {
    if (!state) return [];
    return state.sectionOrder
      .flatMap((id) => [
        ...(state.containers[secId(id)] ?? []),
        // Include items nested inside this section's collapsible groups.
        ...(state.sectionGroups[id] ?? []).flatMap((g) => state.containers[g] ?? []),
      ])
      .map((key) => ({ key, node: pool.items.get(key) }))
      .filter((o) => o.node?.path);
  }, [state, pool]);

  const renderItem = (key: string) => (
    <ItemRow
      key={key}
      itemKey={key}
      node={pool.items.get(key)}
      override={state?.overrides[key]}
      onEdit={() => setEditing(key)}
    />
  );

  const tabs: Tab[] = [
    { id: "me", label: "My Layout" },
    ...(isSuperAdmin ? [{ id: "org", label: "Organization Default" } as Tab] : []),
  ];

  const actions = (
    <>
      <button
        type="button"
        onClick={onReset}
        disabled={saving || loading}
        className="rounded-md border border-[var(--gray-a6)] px-3 py-1.5 text-sm text-[var(--gray-11)] hover:bg-[var(--gray-a3)] disabled:opacity-50"
      >
        {scope === "org" ? "Reset to defaults" : "Reset (follow org default)"}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || loading}
        className="rounded-md bg-[var(--accent-9)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-10)] disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </>
  );

  return (
    <Page title="Navigation">
      <WorkspaceLayout
        title="Navigation"
        tabs={tabs}
        activeTabId={scope}
        onTabChange={(id) => setScope(id as Scope)}
        actions={actions}
      >
        <p className="mb-4 text-sm text-[var(--gray-11)]">
          {scope === "org"
            ? "Arrange the navigation for everyone in the organization. Settings and Sign Out stay pinned; Unsorted items are hidden until you file them."
            : "Arrange your personal navigation. It overrides the organization default until you reset it. Settings and Sign Out stay pinned."}
        </p>

        {message && (
          <div
            className={clsx(
              "mb-4 rounded-md px-3 py-2 text-sm",
              message.kind === "ok"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
            )}
          >
            {message.text}
          </div>
        )}

        {loading || !state ? (
          <p className="text-sm text-[var(--gray-11)]">Loading…</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Sidebar column */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--gray-11)]">
                    Sidebar
                  </h2>
                  <button
                    type="button"
                    onClick={addSection}
                    className="text-sm text-[var(--accent-11)] hover:underline"
                  >
                    + Add section
                  </button>
                </div>
                {state.sectionOrder.map((id, idx) => (
                  <div key={id} className="rounded-lg border border-[var(--gray-a6)] p-2">
                    <div className="mb-1.5 flex items-center gap-2">
                      <input
                        value={state.sectionMeta[id]?.title ?? ""}
                        onChange={(e) => renameSection(id, e.target.value)}
                        placeholder="Untitled (items show ungrouped)"
                        className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-[var(--gray-12)] hover:border-[var(--gray-a5)] focus:border-[var(--accent-8)] focus:outline-none"
                      />
                      <button type="button" onClick={() => moveSection(id, -1)} disabled={idx === 0}
                        className="px-1 text-[var(--gray-10)] hover:text-[var(--gray-12)] disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => moveSection(id, 1)} disabled={idx === state.sectionOrder.length - 1}
                        className="px-1 text-[var(--gray-10)] hover:text-[var(--gray-12)] disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => deleteSection(id)}
                        className="px-1 text-xs text-rose-500 hover:text-rose-600">Delete</button>
                    </div>
                    <Container id={secId(id)} keys={state.containers[secId(id)] ?? []}>
                      {(state.containers[secId(id)] ?? []).map(renderItem)}
                    </Container>

                    {/* Collapsible groups (nested menus) within this section. */}
                    {(state.sectionGroups[id] ?? []).map((gkey) => (
                      <div
                        key={gkey}
                        className="mt-2 rounded-md border border-dashed border-[var(--accent-a6)] bg-[var(--accent-a2)] p-2"
                      >
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-[var(--gray-9)]" aria-hidden>▸</span>
                          {(() => {
                            const gi = state.groups[gkey]?.icon;
                            const GIcon = gi ? navigationIcons[gi] : undefined;
                            return (
                              <button
                                type="button"
                                onClick={() => setIconPickerFor(gkey)}
                                title="Choose group icon"
                                className="flex size-6 shrink-0 items-center justify-center rounded border border-[var(--gray-a5)] text-[var(--gray-10)] hover:border-[var(--accent-8)] hover:text-[var(--accent-11)]"
                              >
                                {GIcon ? <GIcon className="size-4" /> : <span className="text-xs">+</span>}
                              </button>
                            );
                          })()}
                          <input
                            value={state.groups[gkey]?.label ?? ""}
                            onChange={(e) => renameGroup(gkey, e.target.value)}
                            placeholder="Group name"
                            className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-[var(--gray-12)] hover:border-[var(--gray-a5)] focus:border-[var(--accent-8)] focus:outline-none"
                          />
                          <button type="button" onClick={() => deleteGroup(id, gkey)}
                            className="px-1 text-xs text-rose-500 hover:text-rose-600">Delete</button>
                        </div>
                        <Container id={gkey} keys={state.containers[gkey] ?? []}>
                          {(state.containers[gkey] ?? []).map(renderItem)}
                        </Container>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => addGroup(id)}
                      className="mt-2 text-xs text-[var(--accent-11)] hover:underline"
                    >
                      + Add nested group
                    </button>
                  </div>
                ))}
              </div>

              {/* Side column: settings / hidden / unsorted */}
              <div className="space-y-4">
                <div>
                  <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--gray-11)]">
                    Settings page
                  </h2>
                  <Container id={SETTINGS} keys={state.containers[SETTINGS]}>
                    {state.containers[SETTINGS].map(renderItem)}
                  </Container>
                </div>
                <div>
                  <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--gray-11)]">
                    Unsorted (hidden)
                  </h2>
                  <Container id={UNSORTED} keys={state.containers[UNSORTED]}>
                    {state.containers[UNSORTED].map(renderItem)}
                  </Container>
                </div>
                <div>
                  <h2 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--gray-11)]">
                    Hidden
                  </h2>
                  <Container id={HIDDEN} keys={state.containers[HIDDEN]}>
                    {state.containers[HIDDEN].map(renderItem)}
                  </Container>
                </div>
              </div>
            </div>

            <DragOverlay>
              {activeKey ? (
                <div className="rounded-md border border-[var(--accent-8)] bg-[var(--color-panel-solid)] px-2 py-1.5 text-sm shadow-lg">
                  {state.overrides[activeKey]?.label ?? pool.items.get(activeKey)?.title ?? activeKey}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {/* Default landing page */}
        {state && !loading && (
          <div className="mt-6 max-w-md">
            <label className="block text-sm font-medium text-[var(--gray-12)]">
              Default page after login
            </label>
            <p className="mb-1 text-xs text-[var(--gray-11)]">
              Falls back to the first page the user can access if they lack access to this one.
            </p>
            <select
              value={state.defaultRoute ?? ""}
              onChange={(e) => mutate((s) => ({ ...s, defaultRoute: e.target.value || undefined }))}
              className="w-full rounded-md border border-[var(--gray-a6)] bg-[var(--color-panel-solid)] px-2 py-1.5 text-sm text-[var(--gray-12)]"
            >
              <option value="">First available</option>
              {sidebarRouteOptions.map(({ key, node }) => (
                <option key={key} value={key}>
                  {state.overrides[key]?.label ?? node?.title ?? key}
                </option>
              ))}
            </select>
          </div>
        )}

        {editing && state && (
          <OverrideDialog
            label={state.overrides[editing]?.label ?? ""}
            icon={state.overrides[editing]?.icon ?? ""}
            defaultLabel={pool.items.get(editing)?.title ?? editing}
            defaultIcon={pool.items.get(editing)?.icon ?? ""}
            onClose={() => setEditing(null)}
            onSave={(ov) => {
              setOverride(editing, ov);
              setEditing(null);
            }}
          />
        )}

        {iconPickerFor && state && (
          <IconPicker
            value={state.groups[iconPickerFor]?.icon}
            onSelect={(icon) => {
              setGroupIcon(iconPickerFor, icon);
              setIconPickerFor(null);
            }}
            onClose={() => setIconPickerFor(null)}
          />
        )}
      </WorkspaceLayout>
    </Page>
  );
}

function findContainerIn(state: EditorState, key: string): string | undefined {
  if (state.containers[key]) return key;
  return Object.keys(state.containers).find((c) => state.containers[c].includes(key));
}

function OverrideDialog({
  label,
  icon,
  defaultLabel,
  defaultIcon,
  onClose,
  onSave,
}: {
  label: string;
  icon: string;
  defaultLabel: string;
  defaultIcon: string;
  onClose: () => void;
  onSave: (ov: Override) => void;
}) {
  const [l, setL] = useState(label);
  const [i, setI] = useState(icon);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg bg-[var(--color-panel-solid)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-[var(--gray-12)]">Customize item</h3>
        <label className="mb-1 block text-xs text-[var(--gray-11)]">Label</label>
        <input
          value={l}
          onChange={(e) => setL(e.target.value)}
          placeholder={defaultLabel}
          className="mb-3 w-full rounded-md border border-[var(--gray-a6)] bg-transparent px-2 py-1.5 text-sm text-[var(--gray-12)]"
        />
        <label className="mb-1 block text-xs text-[var(--gray-11)]">Icon name</label>
        <input
          value={i}
          onChange={(e) => setI(e.target.value)}
          placeholder={defaultIcon}
          className="mb-1 w-full rounded-md border border-[var(--gray-a6)] bg-transparent px-2 py-1.5 text-sm text-[var(--gray-12)]"
        />
        <p className="mb-3 text-xs text-[var(--gray-9)]">Leave blank to use the module default.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-[var(--gray-11)] hover:bg-[var(--gray-a3)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ label: l.trim() || undefined, icon: i.trim() || undefined })}
            className="rounded-md bg-[var(--accent-9)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-10)]"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
