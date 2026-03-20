import { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon, CodeBracketIcon } from '@heroicons/react/24/outline';
import {
  templateVariableScopes,
  formatVariable,
  type TemplateVariableDefinition,
} from '@/utils/templateVariables';

interface TemplateVariableSelectorProps {
  onInsert: (variable: string) => void;
  availableScopes?: string[]; // Limit which scopes are available (e.g., ['sponsor', 'event'])
  disabled?: boolean;
  className?: string;
}

export function TemplateVariableSelector({
  onInsert,
  availableScopes,
  disabled = false,
  className = '',
}: TemplateVariableSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [showDefaultInput, setShowDefaultInput] = useState<TemplateVariableDefinition | null>(null);
  const [defaultValue, setDefaultValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const defaultInputRef = useRef<HTMLInputElement>(null);

  // Filter scopes based on availableScopes prop
  const filteredScopes = availableScopes
    ? templateVariableScopes.filter(s => availableScopes.includes(s.name))
    : templateVariableScopes;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSelectedScope(null);
        setShowDefaultInput(null);
        setDefaultValue('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus default input when shown
  useEffect(() => {
    if (showDefaultInput && defaultInputRef.current) {
      defaultInputRef.current.focus();
    }
  }, [showDefaultInput]);

  const handleVariableClick = (scope: string, field: string, variable: TemplateVariableDefinition) => {
    // For customer.first_name, show default input option
    if (scope === 'customer' && field === 'first_name') {
      setShowDefaultInput(variable);
      setDefaultValue('');
    } else {
      const formatted = formatVariable(scope, field);
      onInsert(formatted);
      setIsOpen(false);
      setSelectedScope(null);
    }
  };

  const handleInsertWithDefault = () => {
    if (showDefaultInput) {
      const formatted = formatVariable(
        showDefaultInput.scope,
        showDefaultInput.field,
        defaultValue || undefined
      );
      onInsert(formatted);
      setIsOpen(false);
      setSelectedScope(null);
      setShowDefaultInput(null);
      setDefaultValue('');
    }
  };

  const handleInsertWithoutDefault = () => {
    if (showDefaultInput) {
      const formatted = formatVariable(showDefaultInput.scope, showDefaultInput.field);
      onInsert(formatted);
      setIsOpen(false);
      setSelectedScope(null);
      setShowDefaultInput(null);
      setDefaultValue('');
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Insert template variable"
      >
        <CodeBracketIcon className="w-4 h-4" />
        <span>Variables</span>
        <ChevronDownIcon className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          {showDefaultInput ? (
            // Default value input UI
            <div className="p-3">
              <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                Add default value for {showDefaultInput.label}?
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                The default will be used if the recipient has no {showDefaultInput.field.replace('_', ' ')}.
              </p>
              <input
                ref={defaultInputRef}
                type="text"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleInsertWithDefault();
                  } else if (e.key === 'Escape') {
                    setShowDefaultInput(null);
                    setDefaultValue('');
                  }
                }}
                placeholder="e.g., there"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleInsertWithoutDefault}
                  className="flex-1 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  No default
                </button>
                <button
                  type="button"
                  onClick={handleInsertWithDefault}
                  disabled={!defaultValue}
                  className="flex-1 px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Insert
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Preview: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">
                  {formatVariable(showDefaultInput.scope, showDefaultInput.field, defaultValue || undefined)}
                </code>
              </div>
            </div>
          ) : selectedScope ? (
            // Variable list for selected scope
            <div>
              <button
                type="button"
                onClick={() => setSelectedScope(null)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700"
              >
                <ChevronDownIcon className="w-4 h-4 rotate-90" />
                Back to scopes
              </button>
              <div className="max-h-64 overflow-y-auto">
                {filteredScopes
                  .find(s => s.name === selectedScope)
                  ?.variables.map((variable) => (
                    <button
                      key={variable.field}
                      type="button"
                      onClick={() => handleVariableClick(selectedScope, variable.field, { ...variable, scope: selectedScope })}
                      className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {variable.label}
                        </span>
                        <code className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                          {`{{${selectedScope}.${variable.field}}}`}
                        </code>
                      </div>
                      {variable.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {variable.description}
                        </p>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          ) : (
            // Scope selection
            <div className="max-h-64 overflow-y-auto">
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                Select Variable Type
              </div>
              {filteredScopes.map((scope) => (
                <button
                  key={scope.name}
                  type="button"
                  onClick={() => setSelectedScope(scope.name)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {scope.label}
                    </div>
                    {scope.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {scope.description}
                      </p>
                    )}
                  </div>
                  <ChevronDownIcon className="w-4 h-4 -rotate-90 text-gray-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TemplateVariableSelector;
