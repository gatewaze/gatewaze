/**
 * Editor for configuring which people attributes are enabled / required
 * on registration forms. Used in the Settings page.
 */

import { Plus, Trash2, GripVertical, Lock } from 'lucide-react';
import { type PeopleAttributeConfig, LOCKED_ATTRIBUTE_KEYS } from '@gatewaze/shared/types/people';

interface Props {
  value: PeopleAttributeConfig[];
  onChange: (attrs: PeopleAttributeConfig[]) => void;
}

export function PeopleAttributesEditor({ value, onChange }: Props) {
  const isLocked = (key: string) => LOCKED_ATTRIBUTE_KEYS.includes(key);

  const toggleEnabled = (index: number) => {
    if (isLocked(value[index].key)) return;
    const next = [...value];
    const attr = { ...next[index] };
    attr.enabled = !attr.enabled;
    if (!attr.enabled) attr.required = false;
    next[index] = attr;
    onChange(next);
  };

  const toggleRequired = (index: number) => {
    if (isLocked(value[index].key)) return;
    const next = [...value];
    const attr = { ...next[index] };
    if (!attr.enabled) return;
    attr.required = !attr.required;
    next[index] = attr;
    onChange(next);
  };

  const updateLabel = (index: number, label: string) => {
    const next = [...value];
    next[index] = { ...next[index], label };
    onChange(next);
  };

  const remove = (index: number) => {
    if (isLocked(value[index].key)) return;
    onChange(value.filter((_, i) => i !== index));
  };

  const addCustom = () => {
    const key = `custom_${Date.now()}`;
    onChange([...value, { key, label: '', enabled: true, required: false }]);
  };

  return (
    <div className="space-y-3 mt-4">
      {/* Header row */}
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--gray-9)] uppercase tracking-wider px-1">
        <span className="w-5" />
        <span className="flex-1">Attribute</span>
        <span className="w-20 text-center">Visible</span>
        <span className="w-20 text-center">Required</span>
        <span className="w-8" />
      </div>

      <div className="space-y-1">
        {value.map((attr, i) => {
          const locked = isLocked(attr.key);
          return (
            <div
              key={attr.key}
              className="flex items-center gap-2 group rounded-lg border border-[var(--gray-5)] px-2 py-2 hover:border-[var(--gray-7)] transition-colors"
            >
              <GripVertical className="h-4 w-4 text-[var(--gray-8)] shrink-0" />

              {/* Label — editable for custom attrs, read-only for built-in */}
              {locked ? (
                <div className="flex-1 flex items-center gap-1.5">
                  <span className="text-sm">{attr.label}</span>
                  <Lock className="h-3 w-3 text-[var(--gray-8)]" title="Always enabled and required" />
                </div>
              ) : (
                <input
                  value={attr.label}
                  onChange={(e) => updateLabel(i, e.target.value)}
                  placeholder="Attribute name"
                  maxLength={40}
                  className="flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm focus:outline-none focus:border-[var(--gray-6)] focus:bg-[var(--color-surface)]"
                />
              )}

              {/* Enabled toggle */}
              <div className="w-20 flex justify-center">
                <button
                  type="button"
                  onClick={() => toggleEnabled(i)}
                  disabled={locked}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent-9)] focus:ring-offset-2 ${
                    attr.enabled
                      ? 'bg-[var(--accent-9)]'
                      : 'bg-[var(--gray-6)]'
                  } ${locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  title={locked ? 'Always enabled' : attr.enabled ? 'Disable' : 'Enable'}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                      attr.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Required toggle */}
              <div className="w-20 flex justify-center">
                <button
                  type="button"
                  onClick={() => toggleRequired(i)}
                  disabled={locked || !attr.enabled}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent-9)] focus:ring-offset-2 ${
                    attr.required
                      ? 'bg-[var(--accent-9)]'
                      : 'bg-[var(--gray-6)]'
                  } ${locked || !attr.enabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  title={locked ? 'Always required' : !attr.enabled ? 'Enable attribute first' : attr.required ? 'Make optional' : 'Make required'}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                      attr.required ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Delete */}
              <div className="w-8 flex justify-center">
                {!locked && (
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="p-1 rounded text-[var(--gray-9)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addCustom}
        className="flex items-center gap-1.5 text-sm text-[var(--accent-9)] hover:text-[var(--accent-11)] transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add custom attribute
      </button>

      <p className="text-xs text-[var(--gray-9)]">
        First Name and Last Name are always enabled and required. Other attributes can be toggled on/off and set as optional or required for registration.
      </p>
    </div>
  );
}
