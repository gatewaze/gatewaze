import { useMemo, useState } from "react";
import clsx from "clsx";
import { navigationIcons } from "@/app/navigation/icons";

// Clean, user-facing icon names (Heroicon/Lucide short names) — the dotted keys
// like "admin.users" are internal semantic aliases, not palette choices.
const ICON_NAMES = Object.keys(navigationIcons)
  .filter((name) => !name.includes("."))
  .sort();

/** Modal palette for choosing a navigation icon by name, with search. */
export function IconPicker({
  value,
  onSelect,
  onClose,
}: {
  value?: string;
  /** Called with the chosen icon name, or `undefined` to clear. */
  onSelect: (icon: string | undefined) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ICON_NAMES.filter((n) => n.toLowerCase().includes(q)) : ICON_NAMES;
    return list.slice(0, 300);
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-[var(--color-panel-solid)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--gray-12)]">Choose an icon</h3>
          <button
            type="button"
            onClick={() => onSelect(undefined)}
            className="text-xs text-[var(--gray-10)] hover:text-[var(--accent-11)]"
          >
            Clear icon
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons…"
          autoFocus
          className="mb-3 w-full rounded-md border border-[var(--gray-a6)] bg-transparent px-2 py-1.5 text-sm text-[var(--gray-12)]"
        />
        <div className="grid max-h-72 grid-cols-8 gap-1 overflow-y-auto">
          {results.map((name) => {
            const Icon = navigationIcons[name];
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => onSelect(name)}
                className={clsx(
                  "flex aspect-square items-center justify-center rounded-md hover:bg-[var(--accent-a3)]",
                  value === name && "bg-[var(--accent-a3)] ring-1 ring-[var(--accent-8)]",
                )}
              >
                {Icon && <Icon className="size-5 text-[var(--gray-11)]" />}
              </button>
            );
          })}
        </div>
        {results.length === 0 && (
          <p className="py-6 text-center text-sm text-[var(--gray-10)]">No icons match “{query}”.</p>
        )}
      </div>
    </div>
  );
}
