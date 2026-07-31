import type { McpScopeOption } from '@/utils/mcpAccessService';

interface ScopePickerProps {
  /** Available scopes (from GET /api/mcp-admin/scopes). */
  options: McpScopeOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Shown while options are still loading / when the list is empty. */
  emptyHint?: string;
  /** Max-height utility class for the scrollable list. */
  maxHeightClass?: string;
}

/**
 * Checkbox scope picker — same look as the API-key modal's scope list, but
 * driven by the MCP scope catalog instead of a hardcoded option array.
 */
export function ScopePicker({
  options,
  selected,
  onChange,
  emptyHint = 'Loading scopes…',
  maxHeightClass = 'max-h-64',
}: ScopePickerProps) {
  const allSelected = options.length > 0 && selected.size === options.length;

  const toggle = (scope: string) => {
    const next = new Set(selected);
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    onChange(next);
  };

  const toggleAll = () => {
    onChange(allSelected ? new Set() : new Set(options.map((o) => o.scope)));
  };

  return (
    <div>
      <div className="flex justify-end mb-1">
        <button
          type="button"
          onClick={toggleAll}
          className="text-xs text-[var(--accent-11)] hover:underline"
          disabled={options.length === 0}
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div
        className={`space-y-1.5 border border-[var(--gray-a6)] rounded-md p-3 overflow-y-auto ${maxHeightClass}`}
      >
        {options.length === 0 ? (
          <p className="text-xs italic text-[var(--gray-10)]">{emptyHint}</p>
        ) : (
          options.map((opt) => (
            <label
              key={opt.scope}
              className="flex items-start gap-2 cursor-pointer hover:bg-[var(--gray-a3)] -mx-1 px-1 py-0.5 rounded"
            >
              <input
                type="checkbox"
                checked={selected.has(opt.scope)}
                onChange={() => toggle(opt.scope)}
                className="mt-0.5"
              />
              <div>
                <code className="text-xs font-medium">{opt.scope}</code>
                {opt.description && (
                  <p className="text-xs text-[var(--gray-11)]">{opt.description}</p>
                )}
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
