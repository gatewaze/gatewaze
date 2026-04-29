/**
 * Editor for configuring which people attributes are enabled / required
 * on registration forms. Used in the Settings page.
 */

import { useState } from 'react';
import { Plus, Trash2, GripVertical, Lock, ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  type PeopleAttributeConfig,
  type PeopleAttributeType,
  LOCKED_ATTRIBUTE_KEYS,
} from '@gatewaze/shared/types/people';

interface Props {
  value: PeopleAttributeConfig[];
  onChange: (attrs: PeopleAttributeConfig[]) => void;
}

const TYPE_LABELS: Record<PeopleAttributeType, string> = {
  string: 'Short text',
  text: 'Long text',
  select: 'Single select',
  'multi-select': 'Multi-select',
};

export function PeopleAttributesEditor({ value, onChange }: Props) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [newOptionText, setNewOptionText] = useState('');

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

  const updateType = (index: number, type: PeopleAttributeType) => {
    const next = [...value];
    const attr = { ...next[index], type };
    // Initialize options array for select types
    if ((type === 'select' || type === 'multi-select') && !attr.options) {
      attr.options = [];
    }
    // Clear options for non-select types
    if (type === 'string' || type === 'text') {
      delete attr.options;
    }
    next[index] = attr;
    onChange(next);
  };

  const addOption = (index: number, option: string) => {
    if (!option.trim()) return;
    const next = [...value];
    const attr = { ...next[index] };
    attr.options = [...(attr.options || []), option.trim()];
    next[index] = attr;
    onChange(next);
    setNewOptionText('');
  };

  const removeOption = (attrIndex: number, optionIndex: number) => {
    const next = [...value];
    const attr = { ...next[attrIndex] };
    attr.options = (attr.options || []).filter((_: string, i: number) => i !== optionIndex);
    next[attrIndex] = attr;
    onChange(next);
  };

  const remove = (index: number) => {
    if (isLocked(value[index].key)) return;
    if (expandedIndex === index) setExpandedIndex(null);
    onChange(value.filter((_, i) => i !== index));
  };

  const addCustom = () => {
    const key = `custom_${Date.now()}`;
    onChange([...value, { key, label: '', enabled: true, required: false, type: 'string' }]);
    setExpandedIndex(value.length);
  };

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
    setNewOptionText('');
  };

  return (
    <div className="space-y-3 mt-4">
      {/* Header row */}
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--gray-9)] uppercase tracking-wider px-1">
        <span className="w-5" />
        <span className="flex-1">Attribute</span>
        <span className="w-28 text-center">Type</span>
        <span className="w-16 text-center">Visible</span>
        <span className="w-16 text-center">Required</span>
        <span className="w-8" />
      </div>

      <div className="space-y-1">
        {value.map((attr, i) => {
          const locked = isLocked(attr.key);
          const isExpanded = expandedIndex === i;
          const attrType = attr.type || 'string';
          const hasOptions = attrType === 'select' || attrType === 'multi-select';

          return (
            <div key={attr.key} className="rounded-lg border border-[var(--gray-5)] hover:border-[var(--gray-7)] transition-colors">
              <div className="flex items-center gap-2 group px-2 py-2">
                <GripVertical className="h-4 w-4 text-[var(--gray-8)] shrink-0" />

                {/* Label */}
                {locked ? (
                  <div className="flex-1 flex items-center gap-1.5">
                    <span className="text-sm">{attr.label}</span>
                    <Lock className="h-3 w-3 text-[var(--gray-8)]" aria-label="Always enabled and required" />
                  </div>
                ) : (
                  <div className="flex-1 flex items-center gap-1">
                    <input
                      value={attr.label}
                      onChange={(e) => updateLabel(i, e.target.value)}
                      placeholder="Attribute name"
                      maxLength={40}
                      className="flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm focus:outline-none focus:border-[var(--gray-6)] focus:bg-[var(--color-surface)]"
                    />
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(i)}
                        className="p-1 rounded text-[var(--gray-9)] hover:text-[var(--gray-12)] transition-colors"
                        title="Configure field"
                      >
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                )}

                {/* Type badge */}
                <div className="w-28 flex justify-center">
                  {locked ? (
                    <span className="text-xs text-[var(--gray-9)]">{TYPE_LABELS[attrType]}</span>
                  ) : (
                    <select
                      value={attrType}
                      onChange={(e) => updateType(i, e.target.value as PeopleAttributeType)}
                      className="text-xs rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--accent-9)]"
                    >
                      {Object.entries(TYPE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Enabled toggle */}
                <div className="w-16 flex justify-center">
                  <button
                    type="button"
                    onClick={() => toggleEnabled(i)}
                    disabled={locked}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent-9)] focus:ring-offset-2 ${
                      attr.enabled ? 'bg-[var(--accent-9)]' : 'bg-[var(--gray-6)]'
                    } ${locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    title={locked ? 'Always enabled' : attr.enabled ? 'Disable' : 'Enable'}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${attr.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Required toggle */}
                <div className="w-16 flex justify-center">
                  <button
                    type="button"
                    onClick={() => toggleRequired(i)}
                    disabled={locked || !attr.enabled}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent-9)] focus:ring-offset-2 ${
                      attr.required ? 'bg-[var(--accent-9)]' : 'bg-[var(--gray-6)]'
                    } ${locked || !attr.enabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    title={locked ? 'Always required' : !attr.enabled ? 'Enable attribute first' : attr.required ? 'Make optional' : 'Make required'}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${attr.required ? 'translate-x-4' : 'translate-x-0'}`} />
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

              {/* Expanded config panel */}
              {isExpanded && !locked && (
                <div className="px-9 pb-3 pt-1 border-t border-[var(--gray-4)]">
                  {hasOptions && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[var(--gray-9)]">Options</p>
                      {(attr.options || []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {(attr.options || []).map((opt: string, oi: number) => (
                            <span
                              key={oi}
                              className="inline-flex items-center gap-1 rounded-md bg-[var(--gray-3)] border border-[var(--gray-6)] px-2 py-1 text-xs"
                            >
                              {opt}
                              <button
                                type="button"
                                onClick={() => removeOption(i, oi)}
                                className="text-[var(--gray-9)] hover:text-red-500 transition-colors"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={newOptionText}
                          onChange={(e) => setNewOptionText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addOption(i, newOptionText);
                            }
                          }}
                          placeholder="Add an option..."
                          className="flex-1 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-9)]"
                        />
                        <button
                          type="button"
                          onClick={() => addOption(i, newOptionText)}
                          disabled={!newOptionText.trim()}
                          className="rounded bg-[var(--accent-9)] px-3 py-1 text-xs text-white hover:bg-[var(--accent-10)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Add
                        </button>
                      </div>
                      {(attr.options || []).length === 0 && (
                        <p className="text-xs text-[var(--gray-8)]">
                          Add options that users can choose from. Press Enter or click Add.
                        </p>
                      )}
                    </div>
                  )}
                  {!hasOptions && (
                    <p className="text-xs text-[var(--gray-8)]">
                      {attrType === 'string' ? 'Single-line text input.' : 'Multi-line text area for longer responses.'}
                    </p>
                  )}
                </div>
              )}
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
