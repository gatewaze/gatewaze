/**
 * Reusable editor for configuring up to 6 event types.
 * Used in both onboarding and the Settings page.
 */

import { useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { type EventTypeOption, MAX_EVENT_TYPES, labelToValue } from '@/hooks/useEventTypes';

interface Props {
  value: EventTypeOption[];
  onChange: (types: EventTypeOption[]) => void;
}

export function EventTypesEditor({ value, onChange }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const updateLabel = (index: number, label: string) => {
    const next = [...value];
    next[index] = { value: labelToValue(label), label };
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setEditingIndex(null);
  };

  const add = () => {
    if (value.length >= MAX_EVENT_TYPES) return;
    const next = [...value, { value: '', label: '' }];
    onChange(next);
    setEditingIndex(next.length - 1);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {value.map((type, i) => (
          <div
            key={i}
            className="flex items-center gap-2 group"
          >
            <GripVertical className="h-4 w-4 text-[var(--gray-8)] shrink-0" />
            <input
              value={type.label}
              onChange={(e) => updateLabel(i, e.target.value)}
              onFocus={() => setEditingIndex(i)}
              onBlur={() => setEditingIndex(null)}
              placeholder="e.g. Conference, Wedding, Party..."
              maxLength={30}
              className="flex-1 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-9)] focus:border-[var(--accent-9)]"
            />
            {editingIndex === i && type.value && (
              <span className="text-xs text-[var(--gray-9)] shrink-0 font-mono">
                {type.value}
              </span>
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1.5 rounded text-[var(--gray-9)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Remove"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {value.length < MAX_EVENT_TYPES && (
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 text-sm text-[var(--accent-9)] hover:text-[var(--accent-11)] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add event type
        </button>
      )}

      <p className="text-xs text-[var(--gray-9)]">
        {value.length}/{MAX_EVENT_TYPES} event types.
        These appear as filter options on your portal and as the type dropdown when creating events.
      </p>
    </div>
  );
}
