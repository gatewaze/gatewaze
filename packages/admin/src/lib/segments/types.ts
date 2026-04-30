// Segment TypeScript Types
// Customer.io-style segmentation system

// ============================================================================
// Segment Definition Types
// ============================================================================

export interface SegmentDefinition {
  match: 'all' | 'any';
  conditions: SegmentCondition[];
}

export type SegmentCondition =
  | AttributeCondition
  | EventCondition
  | GroupCondition;

export interface GroupCondition {
  type: 'group';
  match: 'all' | 'any';
  conditions: SegmentCondition[];
}

export interface AttributeCondition {
  type: 'attribute';
  field: string;
  operator: AttributeOperator;
  value: AttributeValue;
}

export type AttributeOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_set'
  | 'is_not_set'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'
  | 'in_list'
  | 'not_in_list'
  | 'matches_regex';

export type AttributeValue = string | number | boolean | string[] | null;

export interface EventCondition {
  type: 'event';
  event_type: EventType;
  event_name?: string;
  operator: EventOperator;
  value?: number;
  time_window?: TimeWindow;
  property_filters?: PropertyFilter[];
}

export type EventType =
  | 'offer_accepted'
  | 'offer_viewed'
  | 'competition_entered'
  | 'discount_claimed'
  | 'event_registered'
  | 'event_attended'
  | 'activity'
  | string; // Allow custom event types

export type EventOperator =
  | 'performed'
  | 'not_performed'
  | 'performed_count'
  | 'performed_at_least'
  | 'performed_at_most';

export interface TimeWindow {
  type: 'relative' | 'absolute';
  relative_value?: number;
  relative_unit?: 'days' | 'weeks' | 'months' | 'years';
  start_date?: string;
  end_date?: string;
}

export interface PropertyFilter {
  property: string;
  operator: AttributeOperator;
  value: AttributeValue;
}

// ============================================================================
// Segment Entity Types
// ============================================================================

export type SegmentType = 'manual' | 'dynamic' | 'static';
export type SegmentStatus = 'active' | 'inactive' | 'archived';

export interface Segment {
  id: string;
  name: string;
  description?: string;
  definition: SegmentDefinition;
  type: SegmentType;
  status: SegmentStatus;
  cio_segment_id?: number;
  external_id?: string;
  account_id?: string;
  created_by?: string;
  cached_count: number;
  last_calculated_at?: string;
  calculation_duration_ms?: number;
  created_at: string;
  updated_at: string;
}

export interface SegmentMembership {
  id: number;
  segment_id: string;
  person_id: string;
  joined_at: string;
  last_verified_at: string;
  added_by?: string;
  source: 'calculated' | 'manual' | 'import';
}

export interface SegmentCalculationHistory {
  id: number;
  segment_id: string;
  calculated_at: string;
  member_count: number;
  calculation_duration_ms?: number;
  triggered_by?: string;
  error?: string;
}

// ============================================================================
// API Types
// ============================================================================

export interface CreateSegmentInput {
  name: string;
  description?: string;
  definition: SegmentDefinition;
  type?: SegmentType;
  account_id?: string;
}

export interface UpdateSegmentInput {
  name?: string;
  description?: string;
  definition?: SegmentDefinition;
  status?: SegmentStatus;
}

export interface SegmentPreviewResult {
  count: number;
  sample: SegmentMember[];
}

export interface SegmentMember {
  id: number;
  cio_id: string;
  email: string;
  attributes: CustomerAttributes;
  created_at?: string;
}

export interface CustomerAttributes {
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  country?: string;
  city?: string;
  region?: string;
  linkedin_url?: string;
  twitter_handle?: string;
  bio?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface SegmentListParams {
  status?: SegmentStatus;
  type?: SegmentType;
  account_id?: string;
  page?: number;
  page_size?: number;
  search?: string;
}

export interface SegmentMembersParams {
  page?: number;
  page_size?: number;
  search?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ============================================================================
// UI Helper Types
// ============================================================================

export interface AttributeFieldOption {
  value: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date';
}

export interface EventTypeOption {
  value: EventType;
  label: string;
  description?: string;
}

export interface OperatorOption {
  value: AttributeOperator | EventOperator;
  label: string;
  requiresValue: boolean;
}

// Predefined field options for the UI
export const ATTRIBUTE_FIELDS: AttributeFieldOption[] = [
  { value: 'email', label: 'Email', type: 'string' },
  { value: 'attributes.first_name', label: 'First Name', type: 'string' },
  { value: 'attributes.last_name', label: 'Last Name', type: 'string' },
  { value: 'attributes.company', label: 'Company', type: 'string' },
  { value: 'attributes.job_title', label: 'Job Title', type: 'string' },
  { value: 'attributes.country', label: 'Country', type: 'string' },
  { value: 'attributes.city', label: 'City', type: 'string' },
  { value: 'attributes.region', label: 'Region', type: 'string' },
  { value: 'attributes.linkedin_url', label: 'LinkedIn URL', type: 'string' },
  { value: 'attributes.twitter_handle', label: 'Twitter Handle', type: 'string' },
];

export const EVENT_TYPES: EventTypeOption[] = [
  { value: 'offer_accepted', label: 'Accepted Offer', description: 'Customer accepted an offer' },
  { value: 'offer_viewed', label: 'Viewed Offer', description: 'Customer viewed an offer' },
  { value: 'competition_entered', label: 'Entered Competition', description: 'Customer entered a competition' },
  { value: 'discount_claimed', label: 'Claimed Discount', description: 'Customer claimed a discount' },
  { value: 'event_registered', label: 'Registered for Event', description: 'Customer registered for an event' },
  { value: 'event_attended', label: 'Attended Event', description: 'Customer checked in at an event' },
];

export const ATTRIBUTE_OPERATORS: OperatorOption[] = [
  { value: 'equals', label: 'equals', requiresValue: true },
  { value: 'not_equals', label: 'does not equal', requiresValue: true },
  { value: 'contains', label: 'contains', requiresValue: true },
  { value: 'not_contains', label: 'does not contain', requiresValue: true },
  { value: 'starts_with', label: 'starts with', requiresValue: true },
  { value: 'ends_with', label: 'ends with', requiresValue: true },
  { value: 'is_set', label: 'is set', requiresValue: false },
  { value: 'is_not_set', label: 'is not set', requiresValue: false },
  { value: 'greater_than', label: 'is greater than', requiresValue: true },
  { value: 'less_than', label: 'is less than', requiresValue: true },
  { value: 'in_list', label: 'is in list', requiresValue: true },
  { value: 'not_in_list', label: 'is not in list', requiresValue: true },
];

export const EVENT_OPERATORS: OperatorOption[] = [
  { value: 'performed', label: 'has performed', requiresValue: false },
  { value: 'not_performed', label: 'has not performed', requiresValue: false },
  { value: 'performed_at_least', label: 'has performed at least', requiresValue: true },
  { value: 'performed_at_most', label: 'has performed at most', requiresValue: true },
  { value: 'performed_count', label: 'has performed exactly', requiresValue: true },
];

export const TIME_UNITS: { value: TimeWindow['relative_unit']; label: string }[] = [
  { value: 'days', label: 'days' },
  { value: 'weeks', label: 'weeks' },
  { value: 'months', label: 'months' },
  { value: 'years', label: 'years' },
];

// ============================================================================
// Utility Functions
// ============================================================================

export function createEmptySegmentDefinition(): SegmentDefinition {
  return {
    match: 'all',
    conditions: [],
  };
}

export function createEmptyAttributeCondition(): AttributeCondition {
  return {
    type: 'attribute',
    field: '',
    operator: 'equals',
    value: '',
  };
}

export function createEmptyEventCondition(): EventCondition {
  return {
    type: 'event',
    event_type: 'offer_accepted',
    operator: 'performed',
  };
}

export function createEmptyGroupCondition(): GroupCondition {
  return {
    type: 'group',
    match: 'all',
    conditions: [createEmptyAttributeCondition()],
  };
}

export function isAttributeCondition(
  condition: SegmentCondition
): condition is AttributeCondition {
  return condition.type === 'attribute';
}

export function isEventCondition(
  condition: SegmentCondition
): condition is EventCondition {
  return condition.type === 'event';
}

export function isGroupCondition(
  condition: SegmentCondition
): condition is GroupCondition {
  return condition.type === 'group';
}

export function isValidSegmentDefinition(definition: SegmentDefinition): boolean {
  if (!definition.match || !['all', 'any'].includes(definition.match)) {
    return false;
  }
  if (!Array.isArray(definition.conditions) || definition.conditions.length === 0) {
    return false;
  }
  return definition.conditions.every(isValidCondition);
}

function isValidCondition(condition: SegmentCondition): boolean {
  if (isAttributeCondition(condition)) {
    return Boolean(condition.field && condition.operator);
  }
  if (isEventCondition(condition)) {
    return Boolean(condition.event_type && condition.operator);
  }
  if (isGroupCondition(condition)) {
    return (
      ['all', 'any'].includes(condition.match) &&
      Array.isArray(condition.conditions) &&
      condition.conditions.length > 0 &&
      condition.conditions.every(isValidCondition)
    );
  }
  return false;
}
