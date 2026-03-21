import { useState, useEffect } from 'react';
import {
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CheckIcon,
  TableCellsIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Card, Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';

interface DiscoveredQuestion {
  question_label: string;
  question_type: string | null;
  occurrence_count: number;
  sample_value: string | null;
}

interface MappingRow {
  question_label: string;
  question_type: string | null;
  occurrence_count: number;
  sample_value: string | null;
  target_type: 'customer_attribute' | 'registration_field' | '';
  target_field: string;
  transform: string;
  existingId?: string; // UUID if already saved
}

interface ApplyResult {
  registration_id: string;
  customer_id: number;
  fields_updated: string[];
  errors: string[];
}

const TARGET_OPTIONS = [
  { value: '', label: '— Ignore —', type: '' as const, defaultTransform: 'direct' },
  { value: 'company', label: 'Company', type: 'customer_attribute' as const, defaultTransform: 'direct' },
  { value: 'job_title', label: 'Job title', type: 'customer_attribute' as const, defaultTransform: 'direct' },
  { value: 'linkedin_url', label: 'LinkedIn URL', type: 'customer_attribute' as const, defaultTransform: 'normalize_linkedin' },
  { value: 'phone', label: 'Phone', type: 'customer_attribute' as const, defaultTransform: 'direct' },
  { value: 'sponsor_permission', label: 'Sponsor permission', type: 'registration_field' as const, defaultTransform: 'boolean_inverted' },
];

const TRANSFORM_OPTIONS = [
  { value: 'direct', label: 'Direct (as-is)' },
  { value: 'boolean_inverted', label: 'Boolean inverted (Agreed → false)' },
  { value: 'boolean', label: 'Boolean (Agreed → true)' },
  { value: 'normalize_linkedin', label: 'Normalize LinkedIn URL' },
  { value: 'company_from_object', label: 'Company from object' },
  { value: 'job_title_from_object', label: 'Job title from object' },
];

interface RegistrationFieldMappingsProps {
  eventId: string;
}

export function RegistrationFieldMappings({ eventId }: RegistrationFieldMappingsProps) {
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [registrationCount, setRegistrationCount] = useState<number | null>(null);
  const [applyResults, setApplyResults] = useState<ApplyResult[] | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Resolve varchar event_id to UUID for tables that use UUID FK
  const [eventUuid, setEventUuid] = useState<string | null>(null);

  useEffect(() => {
    async function resolve() {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId);
      if (isUUID) {
        setEventUuid(eventId);
        return;
      }
      const { data } = await supabase
        .from('events')
        .select('id')
        .eq('event_id', eventId)
        .single();
      setEventUuid(data?.id ?? null);
    }
    resolve();
  }, [eventId]);

  // Fetch existing mappings and registration count once UUID is resolved
  useEffect(() => {
    if (!eventUuid) return;
    fetchExistingMappings();
    fetchRegistrationCount();
  }, [eventUuid]);

  const fetchRegistrationCount = async () => {
    if (!eventUuid) return;
    const { count } = await supabase
      .from('events_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventUuid);
    setRegistrationCount(count);
  };

  const fetchExistingMappings = async () => {
    if (!eventUuid) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('registration_field_mappings')
        .select('*')
        .eq('event_id', eventUuid)
        .eq('is_active', true)
        .order('created_at');

      if (error) throw error;

      if (data && data.length > 0) {
        setMappings(data.map((m: any) => ({
          question_label: m.source_label,
          question_type: m.source_question_type,
          occurrence_count: 0,
          sample_value: null,
          target_type: m.target_type,
          target_field: m.target_field,
          transform: m.transform,
          existingId: m.id,
        })));
      }
    } catch (error) {
      console.error('Error fetching mappings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDetectQuestions = async () => {
    setIsDetecting(true);
    try {
      const { data, error } = await supabase.rpc('events_discover_registration_questions', {
        p_event_id: eventUuid,
      });

      if (error) throw error;

      const questions = (data || []) as DiscoveredQuestion[];

      if (questions.length === 0) {
        toast.info('No registration questions found for this event');
        return;
      }

      // Merge discovered questions with existing mappings
      const existingByLabel = new Map(
        mappings.map((m) => [m.question_label.toLowerCase(), m])
      );

      const merged: MappingRow[] = questions.map((q) => {
        const existing = existingByLabel.get(q.question_label.toLowerCase());
        if (existing) {
          return {
            ...existing,
            occurrence_count: q.occurrence_count,
            sample_value: q.sample_value,
            question_type: q.question_type || existing.question_type,
          };
        }
        return {
          question_label: q.question_label,
          question_type: q.question_type,
          occurrence_count: q.occurrence_count,
          sample_value: q.sample_value,
          target_type: '' as const,
          target_field: '',
          transform: 'direct',
        };
      });

      setMappings(merged);
      toast.success(`Found ${questions.length} question${questions.length !== 1 ? 's' : ''}`);
    } catch (error: any) {
      console.error('Error detecting questions:', error);
      toast.error('Failed to detect questions');
    } finally {
      setIsDetecting(false);
    }
  };

  const handleTargetChange = (index: number, targetField: string) => {
    setMappings((prev) => {
      const updated = [...prev];
      const option = TARGET_OPTIONS.find((o) => o.value === targetField);
      updated[index] = {
        ...updated[index],
        target_field: targetField,
        target_type: option?.type || '',
        transform: option?.defaultTransform || 'direct',
      };
      return updated;
    });
    setHasUnsavedChanges(true);
  };

  const handleTransformChange = (index: number, transform: string) => {
    setMappings((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], transform };
      return updated;
    });
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const activeMappings = mappings.filter((m) => m.target_field !== '');
      const ignoredLabels = mappings.filter((m) => m.target_field === '' && m.existingId);

      // Delete mappings that were set to "ignore"
      for (const m of ignoredLabels) {
        await supabase
          .from('registration_field_mappings')
          .delete()
          .eq('id', m.existingId!);
      }

      // Upsert active mappings
      for (const m of activeMappings) {
        if (m.existingId) {
          const { error } = await supabase
            .from('registration_field_mappings')
            .update({
              source_label: m.question_label,
              source_question_type: m.question_type,
              target_type: m.target_type,
              target_field: m.target_field,
              transform: m.transform,
            })
            .eq('id', m.existingId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('registration_field_mappings')
            .insert({
              event_id: eventUuid,
              source_label: m.question_label,
              source_question_type: m.question_type,
              target_type: m.target_type,
              target_field: m.target_field,
              transform: m.transform,
            });
          if (error) throw error;
        }
      }

      toast.success('Mappings saved');
      setHasUnsavedChanges(false);
      fetchExistingMappings();
    } catch (error: any) {
      console.error('Error saving mappings:', error);
      toast.error('Failed to save mappings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyMappings = async () => {
    setIsApplying(true);
    setApplyResults(null);
    try {
      const { data, error } = await supabase.rpc('events_apply_registration_mappings', {
        p_event_id: eventUuid,
      });

      if (error) throw error;

      const results = (data || []) as ApplyResult[];
      setApplyResults(results);

      const updatedCount = results.filter((r) => r.fields_updated.length > 0).length;
      const totalFields = results.reduce((sum, r) => sum + r.fields_updated.length, 0);

      if (updatedCount > 0) {
        toast.success(`Updated ${updatedCount} registration${updatedCount !== 1 ? 's' : ''} (${totalFields} field${totalFields !== 1 ? 's' : ''})`);
      } else {
        toast.info('No registrations needed updating');
      }
    } catch (error: any) {
      console.error('Error applying mappings:', error);
      toast.error('Failed to apply mappings');
    } finally {
      setIsApplying(false);
    }
  };

  const configuredCount = mappings.filter((m) => m.target_field !== '').length;

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="text-center py-6">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div
        className={`px-4 py-3 cursor-pointer select-none ${isExpanded ? 'border-b border-gray-200 dark:border-gray-700' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChevronDownIcon className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
            <TableCellsIcon className="w-5 h-5 text-gray-500" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Registration field mappings</h3>
            {!isExpanded && configuredCount > 0 && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                ({configuredCount} mapping{configuredCount !== 1 ? 's' : ''})
              </span>
            )}
          </div>
          <Button
            color="primary"
            variant="soft"
            className="text-xs px-3 py-1.5 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              handleDetectQuestions();
            }}
            disabled={isDetecting}
          >
            {isDetecting ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin mr-1.5" />
            ) : (
              <MagnifyingGlassIcon className="w-4 h-4 mr-1.5" />
            )}
            Detect questions
          </Button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Map Luma registration questions to customer attributes and registration fields
        </p>
      </div>

      {isExpanded && (
        <>
          {/* Mapping rows */}
          {mappings.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <div className="col-span-5">Question</div>
                <div className="col-span-4">Target field</div>
                <div className="col-span-3">Transform</div>
              </div>

              {mappings.map((mapping, index) => (
                <div
                  key={mapping.question_label}
                  className="grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                >
                  {/* Question label + sample */}
                  <div className="col-span-5">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate" title={mapping.question_label}>
                      {mapping.question_label}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {mapping.occurrence_count > 0 && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {mapping.occurrence_count} response{mapping.occurrence_count !== 1 ? 's' : ''}
                        </span>
                      )}
                      {mapping.sample_value && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[200px]" title={mapping.sample_value}>
                          e.g. "{mapping.sample_value}"
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Target field select */}
                  <div className="col-span-4">
                    <select
                      value={mapping.target_field}
                      onChange={(e) => handleTargetChange(index, e.target.value)}
                      className="form-select w-full text-sm rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white focus:border-primary-500 focus:ring-primary-500 cursor-pointer"
                    >
                      {TARGET_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Transform select */}
                  <div className="col-span-3">
                    <select
                      value={mapping.transform}
                      onChange={(e) => handleTransformChange(index, e.target.value)}
                      disabled={mapping.target_field === ''}
                      className="form-select w-full text-sm rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white focus:border-primary-500 focus:ring-primary-500 disabled:opacity-50 cursor-pointer"
                    >
                      {TRANSFORM_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              Click "Detect questions" to discover registration questions for this event.
            </div>
          )}

          {/* Save button */}
          {mappings.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {configuredCount} mapping{configuredCount !== 1 ? 's' : ''} configured
              </span>
              <Button
                color="primary"
                variant="filled"
                className="text-sm px-4 py-2 cursor-pointer"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ArrowPathIcon className="w-4 h-4 animate-spin mr-1.5" />
                ) : (
                  <CheckIcon className="w-4 h-4 mr-1.5" />
                )}
                Save mappings
              </Button>
            </div>
          )}

          {/* Apply section */}
          {configuredCount > 0 && !hasUnsavedChanges && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    Apply to existing registrations
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {registrationCount !== null
                      ? `${registrationCount} registration${registrationCount !== 1 ? 's' : ''} for this event`
                      : 'Loading count...'}
                  </p>
                </div>
                <Button
                  color="primary"
                  variant="outlined"
                  className="text-sm px-4 py-2 cursor-pointer"
                  onClick={handleApplyMappings}
                  disabled={isApplying}
                >
                  {isApplying ? (
                    <ArrowPathIcon className="w-4 h-4 animate-spin mr-1.5" />
                  ) : (
                    <ArrowPathIcon className="w-4 h-4 mr-1.5" />
                  )}
                  Apply mappings
                </Button>
              </div>

              {/* Apply results */}
              {applyResults && (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  {(() => {
                    const updated = applyResults.filter((r) => r.fields_updated.length > 0).length;
                    const skipped = applyResults.length - updated;
                    const totalFields = applyResults.reduce((sum, r) => sum + r.fields_updated.length, 0);
                    return (
                      <span>
                        {updated} updated ({totalFields} field{totalFields !== 1 ? 's' : ''}), {skipped} unchanged
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
