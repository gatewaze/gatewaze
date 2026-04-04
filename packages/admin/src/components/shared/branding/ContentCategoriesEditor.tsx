/**
 * Reusable editor for configuring content categories with priority ordering.
 * Categories are ordered by priority — position 0 is highest priority.
 * Used in Settings page.
 */

import { useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { type ContentCategoryOption, MAX_CONTENT_CATEGORIES, categoryLabelToValue } from '@/hooks/useContentCategories';

interface Props {
  value: ContentCategoryOption[];
  onChange: (categories: ContentCategoryOption[]) => void;
}

export function ContentCategoriesEditor({ value, onChange }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const updateLabel = (index: number, label: string) => {
    const next = [...value];
    next[index] = { value: categoryLabelToValue(label), label };
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setEditingIndex(null);
  };

  const add = () => {
    if (value.length >= MAX_CONTENT_CATEGORIES) return;
    const next = [...value, { value: '', label: '' }];
    onChange(next);
    setEditingIndex(next.length - 1);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...value];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };

  const moveDown = (index: number) => {
    if (index === value.length - 1) return;
    const next = [...value];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {value.map((cat, i) => (
          <div
            key={i}
            className="flex items-center gap-2 group"
          >
            {/* Priority badge */}
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--accent-3)] text-[var(--accent-11)] text-xs font-medium flex items-center justify-center">
              {i + 1}
            </span>

            {/* Up/Down arrows */}
            <div className="flex flex-col -space-y-0.5 shrink-0">
              <button
                type="button"
                onClick={() => moveUp(i)}
                disabled={i === 0}
                className="p-0.5 rounded text-[var(--gray-9)] hover:text-[var(--gray-12)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Move up (higher priority)"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveDown(i)}
                disabled={i === value.length - 1}
                className="p-0.5 rounded text-[var(--gray-9)] hover:text-[var(--gray-12)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Move down (lower priority)"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            <input
              value={cat.label}
              onChange={(e) => updateLabel(i, e.target.value)}
              onFocus={() => setEditingIndex(i)}
              onBlur={() => setEditingIndex(null)}
              placeholder="e.g. Foundation, Member, Community..."
              maxLength={40}
              className="flex-1 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-9)] focus:border-[var(--accent-9)]"
            />
            {editingIndex === i && cat.value && (
              <span className="text-xs text-[var(--gray-9)] shrink-0 font-mono">
                {cat.value}
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

      {value.length < MAX_CONTENT_CATEGORIES && (
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 text-sm text-[var(--accent-9)] hover:text-[var(--accent-11)] transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add category
        </button>
      )}

      <p className="text-xs text-[var(--gray-9)]">
        {value.length}/{MAX_CONTENT_CATEGORIES} categories.
        The order determines priority — category #1 is highest priority.
        Content is sorted by category priority on the portal.
        {value.length === 0 && ' No categories configured — content will not be prioritised.'}
      </p>
    </div>
  );
}
