import { useMemo, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";

import type { NavLayoutItem } from "@gatewaze/shared/modules";
import type { NavPool } from "@/app/navigation/resolveNavLayout";
import { getNavigationIcon } from "@/app/navigation/icons";
import { HubCardDialog } from "./HubCardDialog";
import { addableItems, isCustomCard, newLinkKey } from "./editorModel";

/**
 * The card list for one module hub page. Cards are independent of the
 * sidebar: adding a page here doesn't move it. A card is either a module page
 * from the pool or a custom card that links to a URL.
 */
export function HubPanel({
  title,
  hubId,
  cards,
  pool,
  moduleDescriptions,
  onChange,
}: {
  /** The hub page's own label, e.g. "Marketing OS". */
  title: string;
  hubId: string;
  cards: NavLayoutItem[];
  pool: NavPool;
  /** Module id -> manifest description, the default card text. */
  moduleDescriptions: Map<string, string>;
  onChange: (cards: NavLayoutItem[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [adding, setAdding] = useState("");
  // Index of the card being edited, or "new" for a custom card being added.
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const options = useMemo(() => addableItems(pool, hubId, cards), [pool, hubId, cards]);

  const defaultsFor = (card: NavLayoutItem) => {
    if (isCustomCard(card)) return {};
    const node = pool.items.get(card.key);
    const moduleId = card.key.startsWith("module.") ? card.key.split(".")[1] : undefined;
    return {
      title: node?.title ?? card.key,
      icon: node?.icon,
      description: moduleId ? moduleDescriptions.get(moduleId) : undefined,
    };
  };

  const onDragEnd = (e: DragEndEvent) => {
    const from = cards.findIndex((c) => c.key === e.active.id);
    const to = e.over ? cards.findIndex((c) => c.key === e.over?.id) : -1;
    if (from >= 0 && to >= 0 && from !== to) onChange(arrayMove(cards, from, to));
  };

  const editingCard: NavLayoutItem | null =
    editing === "new" ? { key: "link:new" } : editing !== null ? (cards[editing] ?? null) : null;

  return (
    <section className="rounded-lg border border-[var(--gray-a6)] p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--gray-11)]">{title} page</h2>
        <p className="text-xs text-[var(--gray-10)]">
          Cards here don't change the sidebar. A page can be in both.
        </p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={cards.map((c) => c.key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5 rounded-md bg-[var(--gray-a2)] p-1.5">
            {cards.map((card, i) => (
              <HubCardRow
                key={card.key}
                card={card}
                fallbackTitle={defaultsFor(card).title}
                fallbackIcon={defaultsFor(card).icon}
                onEdit={() => setEditing(i)}
                onRemove={() => onChange(cards.filter((_, j) => j !== i))}
              />
            ))}
            {cards.length === 0 && (
              <p className="px-1 py-2 text-xs text-[var(--gray-9)]">No cards yet. Add a page or a custom card below.</p>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          aria-label={`Add a page to the ${title} page`}
          className="min-w-0 flex-1 rounded-md border border-[var(--gray-a6)] bg-[var(--color-panel-solid)] px-2 py-1.5 text-sm text-[var(--gray-12)]"
        >
          <option value="">Add a page…</option>
          {options.map((node) => (
            <option key={node.id} value={node.id}>
              {node.title ?? node.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!adding}
          onClick={() => {
            onChange([...cards, { key: adding }]);
            setAdding("");
          }}
          className="rounded-md border border-[var(--gray-a6)] px-3 py-1.5 text-sm text-[var(--gray-12)] hover:bg-[var(--gray-a3)] disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="rounded-md border border-[var(--accent-a7)] px-3 py-1.5 text-sm text-[var(--accent-11)] hover:bg-[var(--accent-a3)]"
        >
          + Add custom card
        </button>
      </div>

      {editingCard && (
        <HubCardDialog
          card={editingCard}
          index={editing === "new" ? cards.length : (editing as number)}
          defaults={defaultsFor(editingCard)}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            if (editing === "new") {
              onChange([...cards, { ...saved, key: newLinkKey(saved.label ?? "", cards) }]);
            } else if (editing !== null) {
              onChange(cards.map((c, j) => (j === editing ? { ...saved, key: c.key } : c)));
            }
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function HubCardRow({
  card,
  fallbackTitle,
  fallbackIcon,
  onEdit,
  onRemove,
}: {
  card: NavLayoutItem;
  fallbackTitle?: string;
  fallbackIcon?: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.key });
  const Icon = getNavigationIcon(card.icon ?? fallbackIcon);
  const custom = isCustomCard(card);
  const title = card.label ?? fallbackTitle ?? card.key;

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
        aria-label={`Drag ${title}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      {Icon && <Icon className="size-4 shrink-0 text-[var(--gray-11)]" aria-hidden />}
      <span className="min-w-0 flex-1 truncate text-[var(--gray-12)]">{title}</span>
      {custom && (
        <span className="max-w-[40%] truncate rounded bg-[var(--accent-a3)] px-1 text-[10px] text-[var(--accent-11)]" title={card.url}>
          {card.url ?? "link"}
        </span>
      )}
      {card.comingSoon && (
        <span className="rounded bg-[var(--gray-a3)] px-1 text-[10px] text-[var(--gray-10)]">coming soon</span>
      )}
      <button type="button" onClick={onEdit} className="text-xs text-[var(--gray-10)] hover:text-[var(--accent-11)]">
        Edit
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${title}`}
        className="text-xs text-rose-500 hover:text-rose-600"
      >
        Remove
      </button>
    </div>
  );
}
