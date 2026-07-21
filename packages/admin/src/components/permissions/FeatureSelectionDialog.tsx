/**
 * Feature Selection Dialog
 * Modal for choosing which modules/pages a team member can access.
 *
 * Grants are per-MODULE: the list is built at runtime from the installed
 * modules (grouped by area, e.g. Events) plus the core pages, so it always
 * matches what's actually installed. Checking a module toggles all of that
 * module's underlying features; the route guard does the enforcement.
 */

import { useState, useEffect, useMemo } from 'react';
import { X, Shield, Check, Search } from 'lucide-react';
import { type AdminFeature } from '@/lib/permissions/types';
import {
  useAdminPermissionCatalog,
  selectedModuleIds,
  modulesToFeatures,
  type CatalogModule,
} from '@/lib/permissions/catalog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

interface FeatureSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (selectedFeatures: AdminFeature[]) => void | Promise<void>;
  initialFeatures?: AdminFeature[];
  userRole?: string;
  userName?: string;
  loading?: boolean;
}

export function FeatureSelectionDialog({
  isOpen,
  onClose,
  onSave,
  initialFeatures = [],
  userRole,
  userName,
  loading = false,
}: FeatureSelectionDialogProps) {
  const catalog = useAdminPermissionCatalog();
  // Selection is tracked by module id (e.g. 'event-speakers', 'core:users').
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  const isSuperAdmin = userRole === 'super_admin';

  // Map the member's currently-granted features onto module selections once the
  // catalog has loaded (or whenever the incoming grant list changes).
  useEffect(() => {
    if (catalog.isLoading) return;
    setSelectedIds(selectedModuleIds(initialFeatures, catalog));
  }, [initialFeatures, catalog]);

  const toggleModule = (id: string) => {
    if (isSuperAdmin) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (moduleIds: string[]) => {
    if (isSuperAdmin) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allOn = moduleIds.every((id) => next.has(id));
      moduleIds.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const selectAll = () => {
    if (isSuperAdmin) return;
    const all = new Set<string>();
    catalog.groups.forEach((g) => g.modules.forEach((m) => all.add(m.id)));
    setSelectedIds(all);
  };

  const clearAll = () => {
    if (isSuperAdmin) return;
    setSelectedIds(new Set());
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave(modulesToFeatures(selectedIds, catalog, initialFeatures));
    } catch (error) {
      console.error('Error saving features:', error);
    } finally {
      setSaving(false);
    }
  };

  // Filter groups/modules by the search term (label, description, or a feature).
  const term = searchTerm.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!term) return catalog.groups;
    const matches = (m: CatalogModule) =>
      m.label.toLowerCase().includes(term) ||
      (m.description?.toLowerCase().includes(term) ?? false) ||
      m.features.some((f) => f.toLowerCase().includes(term));
    return catalog.groups
      .map((g) => ({ ...g, modules: g.modules.filter(matches) }))
      .filter((g) => g.modules.length > 0);
  }, [catalog.groups, term]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
        onClick={onClose}
      ></div>

      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Feature Access</h2>
                  {userName && <p className="text-sm text-gray-600">{userName}</p>}
                </div>
              </div>

              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500 transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {isSuperAdmin && (
              <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-start">
                  <Shield className="h-5 w-5 text-green-600 mt-0.5 mr-2" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Super Admin Access</p>
                    <p className="text-sm text-green-700 mt-0.5">
                      This user has super admin privileges and automatically has access to all
                      modules.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Search & Actions */}
          {!isSuperAdmin && (
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search modules..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={clearAll}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              <div className="mt-3 text-sm text-gray-600">
                <span className="font-medium">{selectedIds.size}</span> of {catalog.moduleCount}{' '}
                modules selected
              </div>
            </div>
          )}

          {/* Module List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {catalog.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="mx-auto">
                    <LoadingSpinner size="large" />
                  </div>
                  <p className="mt-3 text-gray-600">Loading modules...</p>
                </div>
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">
                  {term ? `No modules found matching "${searchTerm}"` : 'No modules available'}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {filteredGroups.map((group) => {
                  const ids = group.modules.map((m) => m.id);
                  const allOn = ids.every((id) => selectedIds.has(id));

                  return (
                    <div key={group.key} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                          {group.label}
                        </h3>

                        {!isSuperAdmin && (
                          <button
                            onClick={() => toggleGroup(ids)}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            {allOn ? 'Deselect All' : 'Select All'}
                          </button>
                        )}
                      </div>

                      <div className="space-y-2">
                        {group.modules.map((mod) => {
                          const isSelected = selectedIds.has(mod.id);

                          return (
                            <label
                              key={mod.id}
                              className={`
                                flex items-start p-4 border rounded-lg cursor-pointer transition-all
                                ${
                                  isSelected
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                }
                                ${isSuperAdmin ? 'opacity-60 cursor-not-allowed' : ''}
                              `}
                            >
                              <div className="flex items-center h-5 mt-0.5">
                                <input
                                  type="checkbox"
                                  checked={isSelected || isSuperAdmin}
                                  onChange={() => toggleModule(mod.id)}
                                  disabled={isSuperAdmin}
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                                />
                              </div>

                              <div className="ml-3 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900">{mod.label}</span>
                                  {!mod.isCore && (
                                    <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">
                                      Module
                                    </span>
                                  )}
                                  {isSelected && !isSuperAdmin && (
                                    <Check className="h-4 w-4 text-blue-600" />
                                  )}
                                </div>
                                {mod.description && (
                                  <p className="text-sm text-gray-600 mt-0.5">{mod.description}</p>
                                )}
                                {mod.route && (
                                  <p className="text-xs text-gray-400 mt-1 font-mono">{mod.route}</p>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-gray-50 px-6 py-4 border-t border-gray-200 rounded-b-lg">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                {!isSuperAdmin && (
                  <>
                    <span className="font-medium text-gray-900">{selectedIds.size}</span> module
                    {selectedIds.size !== 1 ? 's' : ''} will be granted
                  </>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Cancel
                </button>

                <button
                  onClick={handleSave}
                  disabled={saving || isSuperAdmin || loading}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[100px]"
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <LoadingSpinner size="sm" />
                      Saving...
                    </span>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FeatureSelectionDialog;
