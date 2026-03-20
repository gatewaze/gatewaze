/**
 * Feature Selection Dialog
 * Modal for selecting which features a team member can access
 */

import React, { useState, useEffect } from 'react';
import { X, Shield, Check, Search } from 'lucide-react';
import {
  FEATURE_METADATA,
  FEATURE_CATEGORIES,
  type AdminFeature,
} from '@/lib/permissions/types';
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

/**
 * Dialog for selecting features a team member can access
 *
 * @example
 * ```tsx
 * const [isOpen, setIsOpen] = useState(false);
 * const [selectedFeatures, setSelectedFeatures] = useState<AdminFeature[]>([]);
 *
 * const handleSave = async (features: AdminFeature[]) => {
 *   // Grant permissions to user
 *   for (const feature of features) {
 *     await PermissionsService.grantPermission({
 *       admin_id: userId,
 *       feature,
 *     });
 *   }
 *   setIsOpen(false);
 * };
 *
 * <FeatureSelectionDialog
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   onSave={handleSave}
 *   initialFeatures={selectedFeatures}
 *   userName="John Doe"
 * />
 * ```
 */
export function FeatureSelectionDialog({
  isOpen,
  onClose,
  onSave,
  initialFeatures = [],
  userRole,
  userName,
  loading = false,
}: FeatureSelectionDialogProps) {
  const [selectedFeatures, setSelectedFeatures] = useState<Set<AdminFeature>>(
    new Set(initialFeatures)
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  const isSuperAdmin = userRole === 'super_admin';

  // Update selected features when initialFeatures changes
  useEffect(() => {
    setSelectedFeatures(new Set(initialFeatures));
  }, [initialFeatures]);

  const toggleFeature = (feature: AdminFeature) => {
    if (isSuperAdmin) return; // Can't modify super admin

    const newSelected = new Set(selectedFeatures);
    if (newSelected.has(feature)) {
      newSelected.delete(feature);
    } else {
      newSelected.add(feature);
    }
    setSelectedFeatures(newSelected);
  };

  const toggleCategory = (categoryKey: string) => {
    if (isSuperAdmin) return;

    const categoryFeatures = Object.values(FEATURE_METADATA).filter(
      (f) => f.category === categoryKey
    );

    const allSelected = categoryFeatures.every((f) =>
      selectedFeatures.has(f.key)
    );

    const newSelected = new Set(selectedFeatures);

    if (allSelected) {
      // Deselect all in category
      categoryFeatures.forEach((f) => newSelected.delete(f.key));
    } else {
      // Select all in category
      categoryFeatures.forEach((f) => newSelected.add(f.key));
    }

    setSelectedFeatures(newSelected);
  };

  const selectAll = () => {
    if (isSuperAdmin) return;
    const allFeatures = Object.keys(FEATURE_METADATA) as AdminFeature[];
    setSelectedFeatures(new Set(allFeatures));
  };

  const selectNone = () => {
    if (isSuperAdmin) return;
    setSelectedFeatures(new Set());
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave(Array.from(selectedFeatures));
    } catch (error) {
      console.error('Error saving features:', error);
    } finally {
      setSaving(false);
    }
  };

  // Filter features based on search
  const filteredCategories = FEATURE_CATEGORIES.map((category) => {
    const features = Object.values(FEATURE_METADATA).filter((f) => {
      const matchesCategory = f.category === category.key;
      const matchesSearch =
        !searchTerm ||
        f.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.description.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    });

    return { ...category, features };
  }).filter((cat) => cat.features.length > 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
        onClick={onClose}
      ></div>

      {/* Dialog */}
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
                  <h2 className="text-xl font-semibold text-gray-900">
                    Feature Access
                  </h2>
                  {userName && (
                    <p className="text-sm text-gray-600">{userName}</p>
                  )}
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
                    <p className="text-sm font-medium text-green-800">
                      Super Admin Access
                    </p>
                    <p className="text-sm text-green-700 mt-0.5">
                      This user has super admin privileges and automatically has
                      access to all features.
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
                {/* Search */}
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search features..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={selectNone}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {/* Selected Count */}
              <div className="mt-3 text-sm text-gray-600">
                <span className="font-medium">{selectedFeatures.size}</span> of{' '}
                {Object.keys(FEATURE_METADATA).length} features selected
              </div>
            </div>
          )}

          {/* Feature List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="mx-auto">
                    <LoadingSpinner size="large" />
                  </div>
                  <p className="mt-3 text-gray-600">Loading features...</p>
                </div>
              </div>
            ) : filteredCategories.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No features found matching "{searchTerm}"</p>
              </div>
            ) : (
              <div className="space-y-6">
                {filteredCategories.map((category) => {
                  const allCategorySelected = category.features.every((f) =>
                    selectedFeatures.has(f.key)
                  );
                  const someCategorySelected = category.features.some((f) =>
                    selectedFeatures.has(f.key)
                  );

                  return (
                    <div key={category.key} className="space-y-3">
                      {/* Category Header */}
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                          {category.label}
                        </h3>

                        {!isSuperAdmin && (
                          <button
                            onClick={() => toggleCategory(category.key)}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            {allCategorySelected
                              ? 'Deselect All'
                              : 'Select All'}
                          </button>
                        )}
                      </div>

                      {/* Features in Category */}
                      <div className="space-y-2">
                        {category.features.map((feature) => {
                          const isSelected = selectedFeatures.has(feature.key);

                          return (
                            <label
                              key={feature.key}
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
                              {/* Checkbox */}
                              <div className="flex items-center h-5 mt-0.5">
                                <input
                                  type="checkbox"
                                  checked={isSelected || isSuperAdmin}
                                  onChange={() => toggleFeature(feature.key)}
                                  disabled={isSuperAdmin}
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                                />
                              </div>

                              {/* Feature Info */}
                              <div className="ml-3 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900">
                                    {feature.label}
                                  </span>
                                  {isSelected && !isSuperAdmin && (
                                    <Check className="h-4 w-4 text-blue-600" />
                                  )}
                                </div>
                                <p className="text-sm text-gray-600 mt-0.5">
                                  {feature.description}
                                </p>
                                {feature.route && (
                                  <p className="text-xs text-gray-400 mt-1 font-mono">
                                    {feature.route}
                                  </p>
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
                    <span className="font-medium text-gray-900">
                      {selectedFeatures.size}
                    </span>{' '}
                    feature{selectedFeatures.size !== 1 ? 's' : ''} will be
                    granted
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
                  disabled={saving || isSuperAdmin}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[100px]"
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <LoadingSpinner size="xs" />
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
