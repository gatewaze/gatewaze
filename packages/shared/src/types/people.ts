export interface Person {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  avatar_url?: string;
  company?: string;
  job_title?: string;
  location?: string;
  bio?: string;
  linkedin_url?: string;
  twitter_url?: string;
  website_url?: string;
  phone?: string;
  created_at: string;
  updated_at: string;
}

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
