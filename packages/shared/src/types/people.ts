export interface Person {
  id: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  cio_id?: string;
  attributes?: Record<string, any>;
  attribute_timestamps?: Record<string, number>;
  auth_user_id?: string | null;
  has_gravatar?: boolean;
  avatar_source?: 'uploaded' | 'linkedin' | 'gravatar' | null;
  avatar_storage_path?: string | null;
  linkedin_avatar_url?: string | null;
  is_guest?: boolean;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PeopleAttributeConfig {
  key: string;
  label: string;
  enabled: boolean;
  required: boolean;
}

export const DEFAULT_PEOPLE_ATTRIBUTES: PeopleAttributeConfig[] = [
  { key: 'first_name', label: 'First Name', enabled: true, required: true },
  { key: 'last_name', label: 'Last Name', enabled: true, required: true },
  { key: 'company', label: 'Company', enabled: true, required: false },
  { key: 'job_title', label: 'Job Title', enabled: true, required: false },
  { key: 'linkedin_url', label: 'LinkedIn URL', enabled: true, required: false },
];

/** Attribute keys that are always enabled and required (cannot be toggled off) */
export const LOCKED_ATTRIBUTE_KEYS = ['first_name', 'last_name'];

export interface Registration {
  id: string;
  event_id: string;
  person_id: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'attended' | 'no_show';
  registered_at: string;
  checked_in_at?: string;
  cancelled_at?: string;
  notes?: string;
}
