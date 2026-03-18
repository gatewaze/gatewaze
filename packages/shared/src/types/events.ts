export interface Event {
  id: string;
  event_id: string;
  title: string;
  description?: string;
  short_description?: string;
  start_date: string;
  end_date?: string;
  timezone?: string;

  // Location
  location_name?: string;
  location_address?: string;
  city?: string;
  country_code?: string;
  region?: string;
  venue_address?: string;
  venue_content?: string;
  venue_map_image?: string;
  latitude?: number;
  longitude?: number;
  is_virtual: boolean;
  virtual_url?: string;

  // Classification
  event_type?: 'conference' | 'workshop' | 'meetup' | 'webinar' | 'hackathon';
  listing_type?: string;
  listing_intro?: string;
  event_link?: string;
  slug?: string;
  event_topics?: string[];

  // Images & appearance
  image_url?: string;
  logo_url?: string;
  badge_logo?: string;
  featured_image?: string;
  screenshot_url?: string;
  screenshot_generated?: boolean;
  screenshot_generated_at?: string;
  gradient_color_1?: string;
  gradient_color_2?: string;
  gradient_color_3?: string;

  // Status & registration
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  is_live_in_production?: boolean;
  enable_registration?: boolean;
  enable_native_registration?: boolean;
  walkins_allowed?: boolean;
  register_button_text?: string;
  enable_call_for_speakers?: boolean;
  enable_agenda?: boolean;
  capacity?: number;
  registration_url?: string;
  is_free: boolean;
  price?: number;
  currency?: string;

  // Page content
  page_content?: string;
  addedpage_title?: string;
  addedpage_content?: string;

  // Integrations
  luma_event_id?: string;
  gradual_eventslug?: string;
  source_event_id?: string;
  custom_domain?: string;
  custom_domain_status?: string;

  // Source tracking
  source_type?: 'manual' | 'scraper' | 'user_submission';
  source_details?: Record<string, unknown>;
  event_source?: string;
  scraped_by?: string;
  scraper_id?: number;

  // Account
  account_id?: string;
  recommended_event_id?: string;

  // Speaker submission config
  talk_duration_options?: Array<{ duration: number; capacity: number }>;

  // QR
  checkin_qr_code?: string;

  // Offer/marketing
  offer_result?: string;
  offer_value?: string;
  offer_close_date?: string;
  offer_close_display?: string;
  offer_ticket_details?: string;
  offer_slug?: string;
  offer_beta?: boolean;

  // Scraped data (read-only)
  luma_page_data?: Record<string, unknown>;
  meetup_page_data?: Record<string, unknown>;
  luma_processed_html?: string;
  meetup_processed_html?: string;

  // Metadata
  categories?: string[];
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface Speaker {
  id: string;
  name: string;
  email?: string;
  title?: string;
  company?: string;
  bio?: string;
  avatar_url?: string;
  linkedin_url?: string;
  twitter_url?: string;
  website_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EventSpeaker {
  id?: string;
  event_id: string;
  speaker_id: string;
  role?: string;
  display_order?: number;
  speaker_title?: string;
  speaker_bio?: string;
  speaker_topic?: string;
  is_featured?: boolean;
  status?: 'pending' | 'approved' | 'confirmed' | 'reserve' | 'rejected' | 'placeholder';
  company_logo_url?: string;
  member_profile_id?: string;
  speaker?: Speaker;
}

export interface EventTalk {
  id: string;
  event_id: string;
  title: string;
  synopsis?: string;
  duration_minutes?: number;
  session_type?: 'talk' | 'panel' | 'workshop' | 'lightning' | 'fireside' | 'keynote';
  status: 'draft' | 'pending' | 'approved' | 'confirmed' | 'reserve' | 'rejected' | 'placeholder';
  sort_order?: number;
  is_featured?: boolean;
  event_sponsor_id?: string;
  submitted_at?: string;
  reviewed_at?: string;
  reviewed_by?: string;
  confirmation_token?: string;
  edit_token?: string;
  presentation_url?: string;
  created_at: string;
  updated_at: string;
  speakers?: EventTalkSpeaker[];
}

export interface EventTalkSpeaker {
  id?: string;
  talk_id: string;
  speaker_id: string;
  role?: 'presenter' | 'panelist' | 'moderator' | 'co_presenter' | 'host';
  is_primary?: boolean;
  sort_order?: number;
  speaker?: Speaker;
}

export interface AgendaTrack {
  id: string;
  event_id: string;
  name: string;
  description?: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface AgendaEntry {
  id: string;
  event_id: string;
  track_id?: string;
  talk_id?: string;
  title: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  entry_type?: 'session' | 'break' | 'spacer';
  sort_order: number;
  speakers?: Speaker[];
  talk?: EventTalk;
  created_at?: string;
  updated_at?: string;
}

export interface Sponsor {
  id: string;
  name: string;
  slug?: string;
  logo_url?: string;
  website?: string;
  description?: string;
  contact_email?: string;
  contact_phone?: string;
  social_links?: Record<string, string>;
  is_active: boolean;
}

export interface EventSponsor {
  id: string;
  event_id: string;
  sponsor_id: string;
  sponsorship_tier?: 'platinum' | 'gold' | 'silver' | 'bronze' | 'partner' | 'exhibitor';
  booth_number?: string;
  booth_size?: string;
  benefits?: Record<string, unknown>;
  custom_branding?: Record<string, unknown>;
  is_active: boolean;
  sponsor?: Sponsor;
}

export interface EventRegistration {
  id: string;
  event_id: string;
  customer_id: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'attended' | 'no_show';
  registration_type?: 'free' | 'paid' | 'comp' | 'sponsor' | 'speaker' | 'staff' | 'vip';
  ticket_type?: string;
  payment_status?: 'pending' | 'paid' | 'refunded' | 'waived';
  amount_paid?: number;
  discount_code_id?: string;
  badge_print_status?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  registered_at: string;
  checked_in_at?: string;
  cancelled_at?: string;
  customer?: Customer;
}

export interface Customer {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  avatar_url?: string;
  company?: string;
  job_title?: string;
  location?: string;
}

export interface EventAttendance {
  id: string;
  event_id: string;
  customer_id: string;
  registration_id?: string;
  check_in_method?: 'qr_scan' | 'manual_entry' | 'badge_scan' | 'mobile_app' | 'sponsor_booth';
  check_in_location?: string;
  checked_in_at: string;
  checked_out_at?: string;
  sessions_attended?: string[];
  attendance_metadata?: Record<string, unknown>;
  customer?: Customer;
}

export interface DiscountCode {
  id: string;
  event_id: string;
  code: string;
  description?: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  max_uses?: number;
  current_uses: number;
  valid_from?: string;
  valid_until?: string;
  is_active: boolean;
}

export interface BudgetItem {
  id: string;
  event_id: string;
  category: string;
  description?: string;
  amount: number;
  type: 'income' | 'expense';
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export interface EventMedia {
  id: string;
  event_id: string;
  url: string;
  type: 'image' | 'video';
  caption?: string;
  album?: string;
  sort_order: number;
  sponsor_id?: string;
  file_name?: string;
  storage_path?: string;
  file_size?: number;
  mime_type?: string;
  width?: number;
  height?: number;
  is_featured?: boolean;
  display_order?: number;
  uploaded_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parent_id?: string;
}

export interface Topic {
  id: string;
  name: string;
  slug: string;
}
