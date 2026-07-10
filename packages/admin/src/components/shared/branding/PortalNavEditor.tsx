import { useState, useEffect } from "react";
import { Text } from "@radix-ui/themes";
import {
  Bars3Icon,
  EyeIcon,
  EyeSlashIcon,
  PencilIcon,
  CheckIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { supabase } from "@/lib/supabase";

interface NavItemOverride {
  moduleId: string;
  label?: string; // custom label (undefined = use module default)
  order: number;
  hidden?: boolean;
  /** Draft: hidden from the public exactly like `hidden`, but portal admins
   *  (super admins / module feature grants) see the item + pages, badged. */
  draft?: boolean;
}

interface ModuleNavSource {
  moduleId: string;
  defaultLabel: string;
  defaultPath: string;
  defaultIcon: string;
  defaultOrder: number;
}

export interface PortalNavOverrides {
  items: NavItemOverride[];
}

interface Props {
  value: PortalNavOverrides;
  onChange: (value: PortalNavOverrides) => void;
}

export function PortalNavEditor({ value, onChange }: Props) {
  const [modules, setModules] = useState<ModuleNavSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Load enabled modules that have portal_nav
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("installed_modules")
        .select("id, status, portal_nav")
        .eq("status", "enabled");

      const sources: ModuleNavSource[] = [];
      for (const row of data ?? []) {
        if (row.portal_nav && typeof row.portal_nav === "object") {
          const nav = row.portal_nav as { label?: string; path?: string; icon?: string; order?: number };
          if (nav.label && nav.path) {
            sources.push({
              moduleId: row.id,
              defaultLabel: nav.label,
              defaultPath: nav.path,
              defaultIcon: nav.icon || "default",
              defaultOrder: nav.order ?? 100,
            });
          }
        }
      }

      // Add Home item
      sources.unshift({
        moduleId: "_home",
        defaultLabel: "Home",
        defaultPath: "/",
        defaultIcon: "home",
        defaultOrder: 0,
      });

      setModules(sources);
      setLoading(false);
    }
    load();
  }, []);

  // Build merged list: overrides applied on top of module defaults
  const getMergedItems = () => {
    const overrideMap = new Map(value.items.map((o) => [o.moduleId, o]));

    return modules
      .map((mod) => {
        const override = overrideMap.get(mod.moduleId);
        return {
          moduleId: mod.moduleId,
          label: override?.label ?? mod.defaultLabel,
          defaultLabel: mod.defaultLabel,
          path: mod.defaultPath,
          icon: mod.defaultIcon,
          order: override?.order ?? mod.defaultOrder,
          hidden: override?.hidden ?? false,
          draft: (override?.draft && !override?.hidden) ?? false,
          hasCustomLabel: !!override?.label,
        };
      })
      .sort((a, b) => a.order - b.order);
  };

  const items = getMergedItems();

  const updateItem = (moduleId: string, updates: Partial<NavItemOverride>) => {
    const existing = value.items.find((o) => o.moduleId === moduleId);
    const mod = modules.find((m) => m.moduleId === moduleId);
    if (!mod) return;

    const updated: NavItemOverride = {
      moduleId,
      order: existing?.order ?? mod.defaultOrder,
      ...existing,
      ...updates,
    };

    const newItems = value.items.filter((o) => o.moduleId !== moduleId);
    newItems.push(updated);
    onChange({ items: newItems });
  };

  const reorder = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const sorted = [...items];
    const [moved] = sorted.splice(fromIdx, 1);
    sorted.splice(toIdx, 0, moved);

    // Reassign order values based on new position
    const newItems: NavItemOverride[] = sorted.map((item, i) => ({
      moduleId: item.moduleId,
      label: item.hasCustomLabel ? item.label : undefined,
      order: i * 10,
      hidden: item.hidden || undefined,
      draft: item.draft || undefined,
    }));

    onChange({ items: newItems });
  };

  const resetToDefaults = () => {
    onChange({ items: [] });
  };

  const startEdit = (moduleId: string, currentLabel: string) => {
    setEditingId(moduleId);
    setEditLabel(currentLabel);
  };

  const saveEdit = (moduleId: string) => {
    const mod = modules.find((m) => m.moduleId === moduleId);
    const label = editLabel.trim() === mod?.defaultLabel ? undefined : editLabel.trim() || undefined;
    updateItem(moduleId, { label });
    setEditingId(null);
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-[var(--gray-9)]">
        Loading navigation items...
      </div>
    );
  }

  if (modules.length <= 1) {
    return (
      <div className="py-8 text-center text-sm text-[var(--gray-9)]">
        No module navigation items found. Enable modules with portal navigation to configure the menu.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Text as="label" size="2" weight="medium">
            Menu Items
          </Text>
          <Text as="p" size="1" color="gray" className="pb-2">
            Drag to reorder, click the label to rename. The eye toggle cycles visible → draft → hidden;
            draft items (and their pages) are only shown to portal admins, for previewing unreleased content.
          </Text>
        </div>
        <button
          type="button"
          onClick={resetToDefaults}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--gray-11)] hover:bg-[var(--gray-3)] transition-colors"
        >
          <ArrowPathIcon className="size-3.5" />
          Reset
        </button>
      </div>

      <div className="space-y-1">
        {items.map((item, idx) => (
          <div
            key={item.moduleId}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIdx(idx);
            }}
            onDragLeave={() => setDragOverIdx(null)}
            onDrop={() => {
              if (dragIdx !== null) reorder(dragIdx, idx);
              setDragIdx(null);
              setDragOverIdx(null);
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setDragOverIdx(null);
            }}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all ${
              dragOverIdx === idx
                ? "border-[var(--accent-7)] bg-[var(--accent-2)]"
                : dragIdx === idx
                ? "opacity-50 border-[var(--gray-6)]"
                : item.hidden
                ? "border-[var(--gray-4)] bg-[var(--gray-2)] opacity-60"
                : "border-[var(--gray-6)] bg-[var(--color-surface)]"
            }`}
          >
            {/* Drag handle */}
            <Bars3Icon className="size-4 text-[var(--gray-8)] cursor-grab flex-shrink-0" />

            {/* Label */}
            <div className="flex-1 min-w-0">
              {editingId === item.moduleId ? (
                <div className="flex items-center gap-2">
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(item.moduleId);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                    className="flex-1 rounded border border-[var(--accent-7)] bg-[var(--color-surface)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-7)]"
                  />
                  <button
                    type="button"
                    onClick={() => saveEdit(item.moduleId)}
                    className="rounded p-1 hover:bg-[var(--gray-3)]"
                  >
                    <CheckIcon className="size-4 text-[var(--accent-9)]" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${item.hidden ? "line-through text-[var(--gray-9)]" : "text-[var(--gray-12)]"}`}>
                    {item.label}
                  </span>
                  {item.hasCustomLabel && (
                    <span className="text-[10px] text-[var(--gray-8)]">
                      (was: {item.defaultLabel})
                    </span>
                  )}
                  {item.moduleId !== "_home" && (
                    <button
                      type="button"
                      onClick={() => startEdit(item.moduleId, item.label)}
                      className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[var(--gray-3)] transition-opacity"
                      style={{ opacity: undefined }} // always show for now
                    >
                      <PencilIcon className="size-3 text-[var(--gray-9)]" />
                    </button>
                  )}
                </div>
              )}
              <div className="text-xs text-[var(--gray-8)] truncate">{item.path}</div>
            </div>

            {/* Visibility toggle */}
            {/* Visibility: three states cycled by the toggle.
                Visible → Draft (admins-only preview) → Hidden → Visible */}
            {item.moduleId !== "_home" && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {item.draft && (
                  <span className="rounded-full border border-[var(--amber-8)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--amber-11)]">
                    Draft
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (item.hidden) updateItem(item.moduleId, { hidden: undefined, draft: undefined });
                    else if (item.draft) updateItem(item.moduleId, { hidden: true, draft: undefined });
                    else updateItem(item.moduleId, { hidden: undefined, draft: true });
                  }}
                  className="rounded p-1.5 hover:bg-[var(--gray-3)] transition-colors"
                  title={
                    item.hidden
                      ? "Hidden from everyone — click to show in menu"
                      : item.draft
                      ? "Draft: only portal admins see this — click to hide from everyone"
                      : "Visible to everyone — click to mark as draft (admins-only preview)"
                  }
                >
                  {item.hidden ? (
                    <EyeSlashIcon className="size-4 text-[var(--gray-8)]" />
                  ) : item.draft ? (
                    <EyeIcon className="size-4 text-[var(--amber-11)]" />
                  ) : (
                    <EyeIcon className="size-4 text-[var(--gray-11)]" />
                  )}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
